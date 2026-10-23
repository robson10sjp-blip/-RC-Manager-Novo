import { toDate } from "../utils/dates.js";
import {
  getRecordTripId,
  getTripNumberYear,
  tripMatchesRecord,
} from "./tripIdentity.js";

const cents = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100);
const amountFromCents = (value) => Math.round(value) / 100;

export const CHECK_STATUSES = {
  ISSUED: "issued",
  COMPENSATED: "compensated",
  RETURNED: "returned",
  CANCELLED: "cancelled",
};

export function getCheckStatus(installment) {
  if (installment?.method !== "cheque") return null;
  if (Object.values(CHECK_STATUSES).includes(installment.checkStatus)) {
    return installment.checkStatus;
  }
  const remaining = Math.max(
    cents(installment.amount) - cents(installment.paidAmount),
    0
  );
  return remaining === 0 ? CHECK_STATUSES.COMPENSATED : CHECK_STATUSES.ISSUED;
}

export function summarizeChecks(payables = [], today = new Date()) {
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const checks = payables.flatMap((payable) =>
    (payable.installments || [])
      .filter((installment) => installment.method === "cheque")
      .map((installment) => ({
        payableId: payable.id,
        supplierId: payable.supplierId,
        supplierName: payable.supplierName || "Fornecedor não informado",
        description: payable.description || "Compra",
        tripNumber: payable.tripNumber || null,
        installment,
        checkNumber: installment.identification || "",
        bankAccount: installment.bankAccount || "",
        dueDate: toDate(installment.dueDate),
        amount: amountFromCents(
          Math.max(
            cents(installment.amount) - cents(installment.paidAmount),
            0
          )
        ),
        status: getCheckStatus(installment),
      }))
  );
  const upcomingTotals = [7, 15, 30].map((days) => {
    const endExclusive = new Date(startOfToday);
    endExclusive.setDate(endExclusive.getDate() + days + 1);
    return {
      days,
      total: amountFromCents(
        checks.reduce((sum, check) => {
          if (
            check.status !== CHECK_STATUSES.ISSUED ||
            !check.dueDate ||
            check.dueDate < startOfToday ||
            check.dueDate >= endExclusive
          ) {
            return sum;
          }
          return sum + cents(check.amount);
        }, 0)
      ),
    };
  });

  return { checks, upcomingTotals };
}

export function reusePayablePaymentOperation(
  previousOperation,
  fingerprint,
  createReference
) {
  if (
    previousOperation?.fingerprint === fingerprint &&
    previousOperation.paymentReference
  ) {
    return previousOperation;
  }
  const paymentReference = createReference();
  if (!paymentReference?.id) {
    throw new Error("Não foi possível identificar o pagamento.");
  }
  return { fingerprint, paymentReference };
}

export function getPayableBalance(payable) {
  const total = cents(payable.totalAmount);
  const paid = cents(payable.paidAmount);
  return amountFromCents(Math.max(total - paid, 0));
}

export function editSupplierPurchase(payable, {
  description,
  totalAmount,
  purchaseDate,
  dueDate,
  paymentType,
  initialPaymentAmount,
  installmentId = "supplier-edit-adjustment",
  tripId,
  tripName,
  tripNumber,
  tripYear,
}) {
  const totalCents = cents(totalAmount);
  const paidCents = cents(payable.paidAmount);
  if (!Number.isFinite(totalCents) || totalCents <= 0) {
    throw new Error("O total da compra deve ser maior que zero.");
  }
  if (totalCents < paidCents) {
    throw new Error("O total da compra não pode ficar abaixo do valor já pago.");
  }
  if (!String(description || "").trim()) {
    throw new Error("Informe a descrição da compra.");
  }
  const nextPurchaseDate = toDate(purchaseDate);
  if (!nextPurchaseDate) throw new Error("Informe uma data válida para a compra.");
  const nextDueDate = dueDate ? toDate(dueDate) : null;
  if (dueDate && !nextDueDate) throw new Error("Informe um vencimento válido.");

  const balance = amountFromCents(totalCents - paidCents);
  if (!["cash", "credit"].includes(paymentType)) {
    throw new Error("Selecione uma condição de pagamento válida.");
  }
  if (paymentType === "cash" && balance > 0) {
    throw new Error("A condição à vista exige que o total esteja integralmente pago.");
  }

  const installments = (payable.installments || []).map((item) => ({ ...item }));
  const originalSchedule = (payable.installments || [])
    .reduce((sum, item) => sum + cents(item.amount), 0);
  const inferredInitial = originalSchedule > 0
    ? Math.max(cents(payable.totalAmount) - originalSchedule, 0)
    : paidCents >= cents(payable.totalAmount)
      ? cents(payable.totalAmount)
      : 0;
  const initialCents = cents(initialPaymentAmount ?? amountFromCents(inferredInitial));
  if (initialCents > totalCents) {
    throw new Error("O valor da entrada registrada supera o novo total.");
  }
  const expectedSchedule = totalCents - initialCents;
  const scheduleDifference = expectedSchedule - originalSchedule;
  if (scheduleDifference > 0) {
    const target = [...installments].reverse().find(
      (item) => item.method !== "cheque" &&
        cents(item.amount) > cents(item.paidAmount)
    );
    if (target) {
      target.amount = amountFromCents(cents(target.amount) + scheduleDifference);
    } else {
      installments.push({
        id: installmentId,
        amount: amountFromCents(scheduleDifference),
        paidAmount: 0,
        dueDate: nextDueDate,
        method: "boleto",
        identification: "",
        status: "pending",
      });
    }
  } else if (scheduleDifference < 0) {
    let reduction = -scheduleDifference;
    const candidates = installments
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.method !== "cheque")
      .reverse();
    for (const { item } of candidates) {
      const available = Math.max(cents(item.amount) - cents(item.paidAmount), 0);
      const reduced = Math.min(reduction, available);
      item.amount = amountFromCents(cents(item.amount) - reduced);
      reduction -= reduced;
      if (reduction === 0) break;
    }
    if (reduction > 0) {
      throw new Error(
        "Não é possível reduzir o total sem alterar parcelas pagas ou cheques já emitidos."
      );
    }
  }

  for (const installment of installments) {
    if (
      installment.method !== "cheque" &&
      cents(installment.amount) > cents(installment.paidAmount) &&
      nextDueDate
    ) {
      installment.dueDate = nextDueDate;
    }
  }
  const actualSchedule = installments.reduce((sum, item) => sum + cents(item.amount), 0);
  if (actualSchedule !== expectedSchedule) {
    throw new Error("As parcelas atuais não conciliam com o total; revise a condição e a programação antes de salvar.");
  }
  let tripFields = {};
  if (tripId !== undefined) {
    const selectedTripId = String(tripId || "");
    const selectedTripName = String(tripName || "").trim();
    if (selectedTripId && (!selectedTripName || selectedTripName.length > 100)) {
      throw new Error("Selecione uma viagem válida ou deixe a compra sem viagem.");
    }
    const identity = getTripNumberYear({
      name: selectedTripName,
      tripNumber,
      tripYear,
    });
    tripFields = {
      tripId: selectedTripId,
      tripName: selectedTripName,
      tripNumber: identity.tripNumber,
      tripYear: identity.tripYear,
    };
  }

  return {
    description: String(description).trim(),
    totalAmount: amountFromCents(totalCents),
    initialPaymentAmount: amountFromCents(initialCents),
    purchaseDate: nextPurchaseDate,
    ...(nextDueDate ? { dueDate: nextDueDate } : {}),
    paymentType,
    installments,
    balance,
    status: balance === 0 ? "paid" : paidCents > 0 ? "partial" : "pending",
    ...tripFields,
  };
}

export function correctSupplierPayment(payable, payment, corrected) {
  const oldAmount = cents(payment.amount);
  const newAmount = cents(corrected.amount);
  if (!Number.isFinite(newAmount) || newAmount <= 0) {
    throw new Error("O valor corrigido deve ser maior que zero.");
  }
  if (!toDate(corrected.date)) throw new Error("Informe uma data válida para o pagamento.");
  if (!["pix", "dinheiro", "transferencia", "boleto", "cartao", "cheque"].includes(corrected.method)) {
    throw new Error("Selecione uma forma de pagamento válida.");
  }
  if (corrected.method === "cheque") {
    if (!String(corrected.identification || "").trim()) {
      throw new Error("Informe o número do cheque.");
    }
    if (!["bb-pf", "bb-pj"].includes(corrected.bankAccount)) {
      throw new Error("Selecione a conta bancária do cheque.");
    }
    if (!toDate(corrected.issueDate) || !toDate(corrected.expectedCompensationDate)) {
      throw new Error("Informe as datas de emissão e previsão de compensação do cheque.");
    }
  }
  const basePaid = cents(payable.paidAmount) - oldAmount;
  if (basePaid < 0 || basePaid + newAmount > cents(payable.totalAmount)) {
    throw new Error("A correção excede o total da compra ou não concilia com os pagamentos.");
  }
  const installments = (payable.installments || []).map((item) => ({ ...item }));
  for (const allocation of payment.allocations || []) {
    if (!allocation.installmentId) continue;
    const installment = installments.find((item) => item.id === allocation.installmentId);
    if (!installment || cents(installment.paidAmount) < cents(allocation.amount)) {
      throw new Error("Não foi possível conciliar a parcela vinculada ao pagamento.");
    }
    installment.paidAmount = amountFromCents(
      cents(installment.paidAmount) - cents(allocation.amount)
    );
    installment.status = installment.paidAmount > 0 ? "partial" : "pending";
  }

  const base = {
    ...payable,
    paidAmount: amountFromCents(basePaid),
    balance: amountFromCents(cents(payable.totalAmount) - basePaid),
    installments,
    status: basePaid === cents(payable.totalAmount) ? "paid" : basePaid > 0 ? "partial" : "pending",
  };
  const selectedInstallment = corrected.installmentId || payment.installmentId || null;
  if (payment.type === "check-compensation" && selectedInstallment) {
    if (corrected.method !== "cheque") {
      throw new Error("A forma de pagamento de um cheque compensado não pode ser alterada.");
    }
    const check = installments.find((item) => item.id === selectedInstallment);
    if (!check || check.method !== "cheque") {
      throw new Error("O cheque compensado não pertence mais a esta compra.");
    }
    check.amount = amountFromCents(newAmount);
  }
  const result = applyPaymentToPayable(base, {
    amount: amountFromCents(newAmount),
    installmentId: selectedInstallment,
    allowCheckCompensation: payment.type === "check-compensation",
  });
  return {
    ...result,
    installments: result.installments.map((item) => {
      if (item.id !== selectedInstallment || item.method !== "cheque" ||
        payment.type !== "check-compensation") return item;
      return {
        ...item,
        identification: corrected.identification,
        bankAccount: corrected.bankAccount,
        bankName: corrected.bankName || item.bankName,
        issueDate: corrected.issueDate,
        dueDate: corrected.expectedCompensationDate || item.dueDate,
      };
    }),
  };
}

export function createIssuedCheck(payable, check) {
  const amountCents = cents(check.amount);
  const balanceCents = cents(getPayableBalance(payable));
  if (!Number.isFinite(amountCents) || amountCents <= 0 || amountCents > balanceCents) {
    throw new Error("O valor do cheque deve caber no saldo em aberto da compra.");
  }
  if (!String(check.identification || "").trim()) {
    throw new Error("Informe o número do cheque.");
  }
  if (!["bb-pf", "bb-pj"].includes(check.bankAccount)) {
    throw new Error("Selecione a conta bancária do cheque.");
  }
  const issueDate = toDate(check.issueDate);
  const dueDate = toDate(check.expectedCompensationDate);
  if (!issueDate || !dueDate) {
    throw new Error("Informe a emissão e a data prevista de compensação do cheque.");
  }
  if ((payable.installments || []).some((item) =>
    item.method === "cheque" &&
    item.bankAccount === check.bankAccount &&
    String(item.identification || "").trim().toLocaleLowerCase("pt-BR") ===
      String(check.identification).trim().toLocaleLowerCase("pt-BR")
  )) {
    throw new Error("Já existe um cheque com esse número e conta nesta compra.");
  }
  const installments = (payable.installments || []).map((item) => ({ ...item }));
  let toReserve = amountCents;
  const scheduledOpen = installments.reduce(
    (sum, item) => sum + Math.max(cents(item.amount) - cents(item.paidAmount), 0),
    0
  );
  const unallocatedBalance = Math.max(balanceCents - scheduledOpen, 0);
  for (const item of [...installments].reverse()) {
    if (item.method === "cheque") continue;
    const open = Math.max(cents(item.amount) - cents(item.paidAmount), 0);
    const reserve = Math.min(open, toReserve);
    item.amount = amountFromCents(cents(item.amount) - reserve);
    toReserve -= reserve;
    if (toReserve === 0) break;
  }
  if (toReserve > unallocatedBalance) {
    throw new Error("O saldo já está representado por cheques emitidos; não é possível emitir outro sem alterar essas obrigações.");
  }
  installments.push({
    id: check.id,
    amount: amountFromCents(amountCents),
    paidAmount: 0,
    dueDate,
    method: "cheque",
    identification: String(check.identification).trim(),
    bankAccount: check.bankAccount,
    bankName: check.bankName || "Banco do Brasil",
    issueDate,
    checkStatus: CHECK_STATUSES.ISSUED,
    checkStatusHistory: [{ status: CHECK_STATUSES.ISSUED, changedAt: check.createdAt || new Date() }],
    status: "pending",
  });
  return installments;
}

export function correctIssuedCheck(payable, installmentId, changes) {
  const installments = (payable.installments || []).map((item) => ({ ...item }));
  const check = installments.find((item) => item.id === installmentId);
  if (!check || check.method !== "cheque" || getCheckStatus(check) !== CHECK_STATUSES.ISSUED) {
    throw new Error("Somente cheques entregues e ainda não compensados podem ser corrigidos.");
  }
  const amountCents = cents(changes.amount);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("O valor do cheque deve ser maior que zero.");
  }
  if (!String(changes.identification || "").trim()) {
    throw new Error("Informe o número do cheque.");
  }
  if (!["bb-pf", "bb-pj"].includes(changes.bankAccount)) {
    throw new Error("Selecione a conta do cheque.");
  }
  const issueDate = toDate(changes.issueDate);
  const dueDate = toDate(changes.expectedCompensationDate);
  if (!issueDate || !dueDate) {
    throw new Error("Informe as datas de emissão e previsão de compensação.");
  }
  const duplicate = installments.some((item) =>
    item.id !== installmentId &&
    item.method === "cheque" &&
    item.bankAccount === changes.bankAccount &&
    String(item.identification || "").trim().toLocaleLowerCase("pt-BR") ===
      String(changes.identification).trim().toLocaleLowerCase("pt-BR")
  );
  if (duplicate) throw new Error("Já existe outro cheque com esse número e conta.");

  const difference = amountCents - cents(check.amount);
  let adjustment = Math.abs(difference);
  const regularInstallments = installments
    .filter((item) => item.id !== installmentId && item.method !== "cheque")
    .reverse();
  if (difference > 0) {
    for (const item of regularInstallments) {
      const available = Math.max(cents(item.amount) - cents(item.paidAmount), 0);
      const reduction = Math.min(available, adjustment);
      item.amount = amountFromCents(cents(item.amount) - reduction);
      adjustment -= reduction;
      if (adjustment === 0) break;
    }
    if (adjustment > 0) {
      throw new Error("Não há saldo de parcelas comuns suficiente para aumentar este cheque.");
    }
  } else if (difference < 0) {
    const target = regularInstallments.find(
      (item) => cents(item.amount) > cents(item.paidAmount)
    );
    if (target) {
      target.amount = amountFromCents(cents(target.amount) + adjustment);
    } else {
      installments.push({
        id: changes.adjustmentInstallmentId,
        amount: amountFromCents(adjustment),
        paidAmount: 0,
        dueDate,
        method: "boleto",
        identification: "",
        status: "pending",
      });
    }
  }
  check.amount = amountFromCents(amountCents);
  check.identification = String(changes.identification).trim();
  check.bankAccount = changes.bankAccount;
  check.bankName = changes.bankName || "Banco do Brasil";
  check.issueDate = issueDate;
  check.dueDate = dueDate;
  return installments;
}

export function validatePayableSchedule(totalAmount, downPayment, installments) {
  const totalCents = cents(totalAmount);
  const downCents = cents(downPayment);
  const remainingCents = totalCents - downCents;

  if (!Number.isFinite(totalCents) || totalCents <= 0) {
    throw new Error("Informe um valor total maior que zero.");
  }
  if (!Number.isFinite(downCents) || downCents < 0 || downCents > totalCents) {
    throw new Error("A entrada deve estar entre zero e o valor total.");
  }
  if (!Array.isArray(installments)) {
    throw new Error("A lista de parcelas é inválida.");
  }
  if (remainingCents > 0 && installments.length === 0) {
    throw new Error("Cadastre as parcelas ou cheques que representam o saldo.");
  }

  let scheduleCents = 0;
  const checkNumbers = new Set();
  for (const installment of installments) {
    const amount = cents(installment.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Cada parcela deve ter um valor maior que zero.");
    }
    if (!toDate(installment.dueDate)) {
      throw new Error("Informe um vencimento válido para cada parcela.");
    }
    if (installment.method === "cheque") {
      const identification = String(installment.identification || "")
        .trim()
        .toLocaleLowerCase("pt-BR");
      if (!identification) {
        throw new Error("Informe o número de cada cheque.");
      }
      if (checkNumbers.has(identification)) {
        throw new Error("Cada cheque deve ter uma identificação própria.");
      }
      if (!["bb-pf", "bb-pj"].includes(installment.bankAccount)) {
        throw new Error("Selecione a conta PF ou PJ do Banco do Brasil para cada cheque.");
      }
      checkNumbers.add(identification);
    }
    scheduleCents += amount;
  }

  if (scheduleCents !== remainingCents) {
    throw new Error(
      "A soma das parcelas deve corresponder exatamente ao saldo após a entrada."
    );
  }

  return {
    totalAmount: amountFromCents(totalCents),
    paidAmount: amountFromCents(downCents),
    balance: amountFromCents(remainingCents),
  };
}

export function applyPaymentToPayable(payable, payment) {
  const paymentCents = cents(payment.amount);
  const balanceCents = cents(getPayableBalance(payable));
  if (!Number.isFinite(paymentCents) || paymentCents <= 0) {
    throw new Error("O pagamento deve ser maior que zero.");
  }
  if (paymentCents > balanceCents) {
    throw new Error("O pagamento não pode ser maior que o saldo devedor.");
  }

  const installments = (payable.installments || []).map((item) => ({ ...item }));
  const allocations = [];
  let remaining = paymentCents;
  const selectedIndex = payment.installmentId
    ? installments.findIndex((item) => item.id === payment.installmentId)
    : -1;

  if (payment.installmentId && selectedIndex < 0) {
    throw new Error("A parcela selecionada não pertence a esta conta.");
  }
  if (
    selectedIndex >= 0 &&
    getCheckStatus(installments[selectedIndex]) === CHECK_STATUSES.ISSUED &&
    !payment.allowCheckCompensation
  ) {
    throw new Error("Cheque emitido só pode ser baixado ao confirmar a compensação.");
  }

  const allocationIndexes =
    selectedIndex >= 0
      ? [selectedIndex]
      : installments
          .map((item, index) => ({ item, index }))
          .filter(
            ({ item }) =>
              cents(item.amount) > cents(item.paidAmount) &&
              !(
                getCheckStatus(item) === CHECK_STATUSES.ISSUED &&
                !payment.allowCheckCompensation
              )
          )
          .sort(
            (first, second) =>
              (toDate(first.item.dueDate)?.getTime() || 0) -
              (toDate(second.item.dueDate)?.getTime() || 0)
          )
          .map(({ index }) => index);

  for (const index of allocationIndexes) {
    if (remaining === 0) break;
    const installment = installments[index];
    const installmentBalance = Math.max(
      cents(installment.amount) - cents(installment.paidAmount),
      0
    );
    const allocated = Math.min(remaining, installmentBalance);
    if (allocated <= 0) continue;
    installment.paidAmount = amountFromCents(
      cents(installment.paidAmount) + allocated
    );
    installment.status =
      cents(installment.paidAmount) >= cents(installment.amount)
        ? "paid"
        : "partial";
    remaining -= allocated;
    allocations.push({
      installmentId: installment.id,
      amount: amountFromCents(allocated),
    });
  }

  const allocatedToInstallments = paymentCents - remaining;
  if (selectedIndex >= 0 && remaining > 0) {
    throw new Error("O pagamento excede o saldo desta parcela.");
  }
  if (remaining > 0 && installments.length > 0) {
    throw new Error(
      "O pagamento excede o saldo das parcelas em aberto; ajuste a parcela selecionada."
    );
  }
  if (selectedIndex < 0 && installments.length === 0) {
    allocations.push({ installmentId: null, amount: amountFromCents(paymentCents) });
  }

  const paidAmount = amountFromCents(
    cents(payable.paidAmount) + paymentCents
  );
  const balance = amountFromCents(balanceCents - paymentCents);

  return {
    paidAmount,
    balance,
    status: balance === 0 ? "paid" : "partial",
    installments,
    allocations,
    allocatedToInstallments: amountFromCents(allocatedToInstallments),
  };
}

export function applyCheckStatusTransition(
  payable,
  installmentId,
  nextStatus,
  changedAt = new Date()
) {
  if (
    ![
      CHECK_STATUSES.COMPENSATED,
      CHECK_STATUSES.RETURNED,
      CHECK_STATUSES.CANCELLED,
    ].includes(nextStatus)
  ) {
    throw new Error("Selecione um status de cheque válido.");
  }

  const installment = (payable.installments || []).find(
    (item) => item.id === installmentId
  );
  if (!installment || installment.method !== "cheque") {
    throw new Error("O cheque não pertence a esta conta.");
  }
  if (getCheckStatus(installment) !== CHECK_STATUSES.ISSUED) {
    throw new Error("Somente cheques emitidos podem mudar de status.");
  }

  const statusHistory = [
    ...(installment.checkStatusHistory || []),
    {
      status: nextStatus,
      changedAt,
    },
  ];

  if (nextStatus !== CHECK_STATUSES.COMPENSATED) {
    const installments = payable.installments.map((item) =>
      item.id === installmentId
        ? {
            ...item,
            checkStatus: nextStatus,
            checkStatusHistory: statusHistory,
          }
        : { ...item }
    );
    const balance = getPayableBalance(payable);
    return {
      paidAmount: cents(payable.paidAmount) / 100,
      balance,
      status:
        balance === 0
          ? "paid"
          : cents(payable.paidAmount) > 0
            ? "partial"
            : "pending",
      installments,
      allocations: [],
    };
  }

  const remaining = amountFromCents(
    Math.max(cents(installment.amount) - cents(installment.paidAmount), 0)
  );
  if (remaining <= 0) {
    throw new Error("Este cheque já está totalmente baixado.");
  }

  const paymentResult = applyPaymentToPayable(payable, {
    amount: remaining,
    installmentId,
    allowCheckCompensation: true,
  });
  return {
    ...paymentResult,
    installments: paymentResult.installments.map((item) =>
      item.id === installmentId
        ? {
            ...item,
            checkStatus: nextStatus,
            checkStatusHistory: statusHistory,
          }
        : item
    ),
  };
}

export function summarizePayables(payables = [], today = new Date()) {
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const nextMonth = new Date(startOfToday);
  nextMonth.setDate(nextMonth.getDate() + 30);
  const active = payables.map((payable) => ({
    ...payable,
    balance: getPayableBalance(payable),
  }));
  const overdueItems = [];
  const upcomingItems = [];

  for (const payable of active) {
    for (const installment of payable.installments || []) {
      const open = Math.max(
        cents(installment.amount) - cents(installment.paidAmount),
        0
      );
      const dueDate = toDate(installment.dueDate);
      if (!open || !dueDate) continue;
      const entry = {
        payableId: payable.id,
        supplierId: payable.supplierId,
        supplierName: payable.supplierName || "Fornecedor não informado",
        description: payable.description || "Compra",
        amount: amountFromCents(open),
        dueDate,
        method: installment.method || "",
        identification: installment.identification || "",
      };
      if (dueDate < startOfToday) overdueItems.push(entry);
      else if (dueDate < nextMonth) upcomingItems.push(entry);
    }
  }

  overdueItems.sort((first, second) => first.dueDate - second.dueDate);
  upcomingItems.sort((first, second) => first.dueDate - second.dueDate);
  const overduePayableIds = new Set(overdueItems.map((item) => item.payableId));

  return {
    totalToPay: amountFromCents(
      active.reduce((sum, payable) => sum + cents(payable.balance), 0)
    ),
    totalPaid: amountFromCents(
      active.reduce((sum, payable) => sum + cents(payable.paidAmount), 0)
    ),
    overdueCount: overduePayableIds.size,
    overdueTotal: amountFromCents(
      overdueItems.reduce((sum, item) => sum + cents(item.amount), 0)
    ),
    upcomingCount: upcomingItems.length,
    upcomingTotal: amountFromCents(
      upcomingItems.reduce((sum, item) => sum + cents(item.amount), 0)
    ),
    overdueItems,
    upcomingItems,
    active,
  };
}

export function filterPayablesByTrip(payables = [], tripFilter = "all") {
  if (tripFilter === "all") return payables;
  if (tripFilter === "unassigned") {
    return payables.filter((payable) => !getRecordTripId(payable));
  }
  if (typeof tripFilter === "object") {
    return payables.filter((payable) => tripMatchesRecord(payable, tripFilter));
  }
  const selected = tripFilter === "third" ? 3 : tripFilter === "fourth" ? 4 : Number(tripFilter);
  if (Number.isFinite(selected)) {
    return payables.filter((payable) => Number(payable.tripNumber) === selected);
  }
  return payables.filter(
    (payable) => tripMatchesRecord(payable, { id: tripFilter })
  );
}
