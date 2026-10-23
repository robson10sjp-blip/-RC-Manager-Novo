import {
  collection,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { runTransaction } from "../firebase/firestoreAccess.js";
import {
  applyCheckStatusTransition,
  correctSupplierPayment as calculatePaymentCorrection,
  correctIssuedCheck as calculateIssuedCheckCorrection,
  createIssuedCheck as appendIssuedCheck,
  editSupplierPurchase as calculatePurchaseEdit,
  getPayableBalance,
} from "../domain/payables.js";

function requireOwner(userId) {
  if (!userId) throw new Error("Entre novamente no RC Manager para continuar.");
}

function correctionReference(db, userId, payableId, correctionId) {
  return doc(db, "users", userId, "payables", payableId, "corrections", correctionId);
}

export async function editSupplierPurchase({
  db,
  userId,
  payableId,
  changes,
  checks = [],
  correctionId: requestedCorrectionId,
}) {
  requireOwner(userId);
  const payableReference = doc(db, "users", userId, "payables", payableId);
  const correctionId = requestedCorrectionId ||
    doc(collection(db, "users", userId, "payables", payableId, "corrections")).id;
  const correction = correctionReference(db, userId, payableId, correctionId);
  const operationFingerprint = JSON.stringify({ changes, checks });
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(payableReference);
    const correctionSnapshot = await transaction.get(correction);
    if (!snapshot.exists()) throw new Error("A compra do fornecedor não foi encontrada.");
    const before = snapshot.data();
    if (correctionSnapshot.exists()) {
      if (
        before.lastCorrectionId === correctionId &&
        correctionSnapshot.data().operationFingerprint === operationFingerprint
      ) {
        return { correctionId, issuedChecks: checks.map((check) => ({
          checkId: `supplier-check-${check.operationId}`,
          alreadyRecorded: true,
        })) };
      }
      throw new Error("Este identificador de correção já foi usado com outros dados.");
    }
    const scheduleTotal = (before.installments || [])
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const initialPaymentAmount = before.initialPaymentAmount ??
      (scheduleTotal === 0 && Number(before.paidAmount || 0) >= Number(before.totalAmount || 0)
        ? Number(before.totalAmount || 0)
        : undefined);
    let after = calculatePurchaseEdit(
      { id: snapshot.id, ...before },
      { ...changes, initialPaymentAmount, installmentId: `supplier-edit-${correctionId}` }
    );
    const issuedChecks = [];
    for (const check of checks) {
      const checkId = `supplier-check-${check.operationId}`;
      const existing = after.installments.find((item) => item.id === checkId);
      if (existing) {
        if (
          Number(existing.amount) !== Number(check.amount) ||
          existing.identification !== String(check.identification).trim() ||
          existing.bankAccount !== check.bankAccount ||
          (existing.linkedInstallmentId || "") !== (check.installmentId || "")
        ) {
          throw new Error("O identificador deste cheque já foi usado com outros dados.");
        }
        issuedChecks.push({ checkId, alreadyRecorded: true });
        continue;
      }
      after = {
        ...after,
        installments: appendIssuedCheck(after, {
          id: checkId,
          amount: check.amount,
          identification: check.identification,
          bankAccount: check.bankAccount,
          bankName: check.bankName,
          issueDate: check.issueDate,
          expectedCompensationDate: check.expectedCompensationDate,
          installmentId: check.installmentId,
          createdAt: new Date(),
        }),
      };
      issuedChecks.push({ checkId, alreadyRecorded: false });
    }
    const auditFields = {
      description: after.description,
      totalAmount: after.totalAmount,
      purchaseDate: after.purchaseDate,
      dueDate: after.dueDate || null,
      paymentType: after.paymentType,
      initialPaymentAmount: after.initialPaymentAmount,
      installments: after.installments,
      balance: after.balance,
      status: after.status,
    };
    const tripFields = {
      tripId: after.tripId ?? before.tripId ?? "",
      tripName: after.tripName ?? before.tripName ?? "",
      tripNumber: after.tripNumber ?? before.tripNumber ?? null,
      tripYear: after.tripYear ?? before.tripYear ?? null,
    };
    transaction.set(correction, {
      type: "purchase",
      payableId,
      operationFingerprint,
      before: {
        description: before.description ?? null,
        totalAmount: before.totalAmount,
        purchaseDate: before.purchaseDate ?? null,
        dueDate: before.dueDate || null,
        paymentType: before.paymentType ?? null,
        balance: getPayableBalance(before),
        tripId: before.tripId ?? "",
        tripName: before.tripName ?? "",
        tripNumber: before.tripNumber ?? null,
        tripYear: before.tripYear ?? null,
      },
      after: { ...auditFields, ...tripFields },
      createdAt: serverTimestamp(),
    });
    transaction.update(payableReference, {
      ...auditFields,
      ...(Object.hasOwn(changes, "tripId") ? tripFields : {}),
      lastCorrectionId: correctionId,
      updatedAt: serverTimestamp(),
    });
    return { correctionId, issuedChecks };
  });
}

export async function issueSupplierCheck({
  db,
  userId,
  payableId,
  operationId,
  amount,
  identification,
  bankAccount,
  bankName,
  issueDate,
  expectedCompensationDate,
}) {
  const [result] = await issueSupplierChecks({
    db,
    userId,
    payableId,
    checks: [{
      operationId,
      amount,
      identification,
      bankAccount,
      bankName,
      issueDate,
      expectedCompensationDate,
    }],
  });
  return result;
}

export async function issueSupplierChecks({
  db,
  userId,
  payableId,
  checks,
}) {
  requireOwner(userId);
  if (!Array.isArray(checks) || checks.length === 0) return [];
  if (checks.some((check) => !check.operationId)) {
    throw new Error("Não foi possível identificar todos os cheques.");
  }
  const payableReference = doc(db, "users", userId, "payables", payableId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(payableReference);
    if (!snapshot.exists()) throw new Error("A compra do fornecedor não foi encontrada.");
    let payable = { id: snapshot.id, ...snapshot.data() };
    const results = [];
    let changed = false;
    for (const check of checks) {
      const checkId = `supplier-check-${check.operationId}`;
      const existing = payable.installments?.find((item) => item.id === checkId);
      if (existing) {
        if (
          Number(existing.amount) !== Number(check.amount) ||
          existing.identification !== String(check.identification).trim() ||
          existing.bankAccount !== check.bankAccount
        ) {
          throw new Error("O identificador deste cheque já foi usado com outros dados.");
        }
        results.push({ checkId, alreadyRecorded: true });
        continue;
      }
      payable = {
        ...payable,
        installments: appendIssuedCheck(payable, {
          id: checkId,
          amount: check.amount,
          identification: check.identification,
          bankAccount: check.bankAccount,
          bankName: check.bankName,
          issueDate: check.issueDate,
          expectedCompensationDate: check.expectedCompensationDate,
          createdAt: new Date(),
        }),
      };
      changed = true;
      results.push({ checkId, alreadyRecorded: false });
    }
    if (changed) {
      transaction.update(payableReference, {
        installments: payable.installments,
        updatedAt: serverTimestamp(),
      });
    }
    return results;
  });
}

export async function compensateSupplierCheck({
  db,
  userId,
  payableId,
  installmentId,
  changedAt = new Date(),
}) {
  requireOwner(userId);
  const payableReference = doc(db, "users", userId, "payables", payableId);
  const paymentReference = doc(
    db,
    "users",
    userId,
    "payables",
    payableId,
    "payments",
    `check-compensation-${installmentId}`
  );
  return runTransaction(db, async (transaction) => {
    const paymentSnapshot = await transaction.get(paymentReference);
    if (paymentSnapshot.exists()) return true;
    const payableSnapshot = await transaction.get(payableReference);
    if (!payableSnapshot.exists()) throw new Error("A compra do fornecedor não foi encontrada.");
    const payable = { id: payableSnapshot.id, ...payableSnapshot.data() };
    const check = payable.installments?.find((item) => item.id === installmentId);
    const result = applyCheckStatusTransition(
      payable,
      installmentId,
      "compensated",
      changedAt
    );
    const allocation = result.allocations.find(
      (item) => item.installmentId === installmentId
    );
    if (!allocation || !check) throw new Error("Não foi possível associar a compensação ao cheque.");
    transaction.update(payableReference, {
      paidAmount: result.paidAmount,
      balance: result.balance,
      status: result.status,
      installments: result.installments,
      updatedAt: serverTimestamp(),
    });
    transaction.set(paymentReference, {
      operationId: paymentReference.id,
      type: "check-compensation",
      amount: allocation.amount,
      date: changedAt,
      method: "cheque",
      identification: check.identification,
      bankAccount: check.bankAccount || "",
      bankName: check.bankName || "Banco do Brasil",
      issueDate: check.issueDate || null,
      expectedCompensationDate: check.dueDate || null,
      checkId: installmentId,
      installmentId,
      allocations: [allocation],
      createdAt: serverTimestamp(),
    });
    return false;
  });
}

export async function correctSupplierCheck({
  db,
  userId,
  payableId,
  installmentId,
  changes,
}) {
  requireOwner(userId);
  const payableReference = doc(db, "users", userId, "payables", payableId);
  const correctionId = doc(collection(db, "users", userId, "payables", payableId, "corrections")).id;
  const correction = correctionReference(db, userId, payableId, correctionId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(payableReference);
    if (!snapshot.exists()) throw new Error("A compra do fornecedor não foi encontrada.");
    const before = snapshot.data();
    const currentCheck = (before.installments || []).find((item) => item.id === installmentId);
    if (!currentCheck) throw new Error("O cheque selecionado não pertence à compra.");
    const installments = calculateIssuedCheckCorrection(
      { id: snapshot.id, ...before },
      installmentId,
      { ...changes, adjustmentInstallmentId: `check-edit-${correctionId}` }
    );
    const after = {
      description: before.description || "",
      totalAmount: before.totalAmount,
      purchaseDate: before.purchaseDate || null,
      dueDate: before.dueDate || null,
      paymentType: before.paymentType || "credit",
      initialPaymentAmount: before.initialPaymentAmount ?? null,
      balance: before.balance ?? null,
      status: before.status ?? null,
      tripId: before.tripId ?? "",
      tripName: before.tripName ?? "",
      tripNumber: before.tripNumber ?? null,
      tripYear: before.tripYear ?? null,
      installments,
    };
    transaction.set(correction, {
      type: "check",
      payableId,
      installmentId,
      before: currentCheck,
      after,
      createdAt: serverTimestamp(),
    });
    transaction.update(payableReference, {
      installments,
      lastCorrectionId: correctionId,
      updatedAt: serverTimestamp(),
    });
    return correctionId;
  });
}

export async function correctSupplierPayment({
  db,
  userId,
  payableId,
  paymentId,
  changes,
}) {
  requireOwner(userId);
  const payableReference = doc(db, "users", userId, "payables", payableId);
  const paymentReference = doc(
    db,
    "users",
    userId,
    "payables",
    payableId,
    "payments",
    paymentId
  );
  const correctionId = doc(collection(db, "users", userId, "payables", payableId, "corrections")).id;
  const correction = correctionReference(db, userId, payableId, correctionId);
  return runTransaction(db, async (transaction) => {
    const [payableSnapshot, paymentSnapshot] = await Promise.all([
      transaction.get(payableReference),
      transaction.get(paymentReference),
    ]);
    if (!payableSnapshot.exists() || !paymentSnapshot.exists()) {
      throw new Error("A compra ou o pagamento não foi encontrado.");
    }
    const payable = { id: payableSnapshot.id, ...payableSnapshot.data() };
    const before = paymentSnapshot.data();
    const nextPayment = {
      ...before,
      ...changes,
      amount: Number(changes.amount),
      method: changes.method,
      identification: String(changes.identification || "").trim(),
      bankAccount: changes.method === "cheque" ? changes.bankAccount : "",
      bankName: changes.method === "cheque" ? changes.bankName : "",
      issueDate: changes.method === "cheque" ? changes.issueDate : null,
      expectedCompensationDate:
        changes.method === "cheque" ? changes.expectedCompensationDate : null,
    };
    const result = calculatePaymentCorrection(payable, before, nextPayment);
    const auditAfter = {
      amount: nextPayment.amount,
      date: nextPayment.date,
      method: nextPayment.method,
      identification: nextPayment.identification,
      bankAccount: nextPayment.bankAccount,
      bankName: nextPayment.bankName,
      issueDate: nextPayment.issueDate,
      expectedCompensationDate: nextPayment.expectedCompensationDate,
      allocations: result.allocations,
    };
    transaction.set(correction, {
      type: "payment",
      payableId,
      paymentId,
      before,
      after: auditAfter,
      createdAt: serverTimestamp(),
    });
    transaction.update(paymentReference, {
      ...auditAfter,
      lastCorrectionId: correctionId,
      updatedAt: serverTimestamp(),
    });
    transaction.update(payableReference, {
      paidAmount: result.paidAmount,
      balance: result.balance,
      status: result.status,
      installments: result.installments,
      updatedAt: serverTimestamp(),
    });
    return correctionId;
  });
}
