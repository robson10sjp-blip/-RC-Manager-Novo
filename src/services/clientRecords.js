import {
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { runTransaction } from "../firebase/firestoreAccess.js";
import {
  calculateGiftCost,
  createVisitRecordId,
  validateGiftQuantity,
} from "../domain/clientRecords.js";

export const CLIENT_RECORD_WRITES_ENABLED = false;

function assertClientRecordWritesEnabled() {
  if (!CLIENT_RECORD_WRITES_ENABLED) {
    throw new Error(
      "Gravações de visitas, Clientes Prego e brindes aguardam revisão das regras Firestore."
    );
  }
}

export async function recordClientVisit({
  db,
  userId,
  clientId,
  city,
  tripName,
  status,
}) {
  assertClientRecordWritesEnabled();
  if (!["not_purchased", "unvisited"].includes(status)) {
    throw new Error("Situação de visita inválida.");
  }
  const recordId = createVisitRecordId(clientId, tripName);
  const reference = doc(db, "users", userId, "clientVisits", recordId);

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    const saved = snapshot.exists() ? snapshot.data() : {};
    if (saved.status === status) return false;

    transaction.set(
      reference,
      {
        clientId,
        city,
        tripName,
        status,
        history: [
          ...(Array.isArray(saved.history) ? saved.history : []),
          { status, changedAt: new Date().toISOString() },
        ],
        createdAt: saved.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  });
}

export async function recordClientGift({
  db,
  userId,
  operationId,
  clientId,
  productId,
  quantity,
  tripName,
  tripCity,
}) {
  assertClientRecordWritesEnabled();
  if (!operationId) throw new Error("Identificador da entrega ausente.");
  const giftReference = doc(db, "users", userId, "clientGifts", `gift-${operationId}`);
  const productReference = doc(db, "users", userId, "products", productId);
  const movementReference = doc(
    db,
    "users",
    userId,
    "stockMovements",
    `gift-${giftReference.id}`
  );

  await runTransaction(db, async (transaction) => {
    const existingGift = await transaction.get(giftReference);
    const existingMovement = await transaction.get(movementReference);
    if (existingGift.exists()) {
      const savedGift = existingGift.data();
      if (!existingMovement.exists()) {
        throw new Error("O histórico do brinde está inconsistente; o estoque não foi alterado.");
      }
      if (
        savedGift.clientId !== clientId ||
        savedGift.productId !== productId ||
        Number(savedGift.quantity) !== Number(quantity) ||
        savedGift.tripName !== tripName ||
        savedGift.tripCity !== tripCity
      ) {
        throw new Error("Identificador de entrega já utilizado com outros dados.");
      }
      return;
    }
    if (existingMovement.exists()) {
      throw new Error("Já existe uma movimentação com este identificador.");
    }

    const productSnapshot = await transaction.get(productReference);
    if (!productSnapshot.exists()) {
      throw new Error("O produto selecionado não existe mais no estoque.");
    }
    const product = productSnapshot.data();
    const available = Math.floor(Number(product.quantity) || 0);
    const count = validateGiftQuantity(quantity, available);
    if (
      product.costPrice === null ||
      product.costPrice === undefined ||
      product.costPrice === "" ||
      !Number.isFinite(Number(product.costPrice)) ||
      Number(product.costPrice) < 0
    ) {
      throw new Error("Cadastre um custo válido para este produto antes de dar o brinde.");
    }
    const unitCost = Number(product.costPrice);
    const totalCost = calculateGiftCost(unitCost, count);
    const nextQuantity = available - count;

    transaction.update(productReference, {
      quantity: nextQuantity,
      updatedAt: serverTimestamp(),
    });
    transaction.set(giftReference, {
      clientId,
      productId,
      productName: product.name || "",
      quantity: count,
      giftDate: serverTimestamp(),
      tripName,
      tripCity,
      unitCost,
      totalCost,
      status: "active",
      stockMovementId: movementReference.id,
      createdAt: serverTimestamp(),
    });
    transaction.set(movementReference, {
      type: "brinde",
      reason: "Brinde registrado para cliente",
      clientId,
      productId,
      productName: product.name || "",
      quantity: count,
      previousQuantity: available,
      newQuantity: nextQuantity,
      unitCost,
      totalCost,
      giftId: giftReference.id,
      createdAt: serverTimestamp(),
    });
  });
  return giftReference.id;
}

export async function cancelClientGift({ db, userId, gift }) {
  assertClientRecordWritesEnabled();
  const giftReference = doc(db, "users", userId, "clientGifts", gift.id);
  const productReference = doc(
    db,
    "users",
    userId,
    "products",
    gift.productId
  );
  const reversalReference = doc(
    db,
    "users",
    userId,
    "stockMovements",
    `gift-cancel-${gift.id}`
  );

  await runTransaction(db, async (transaction) => {
    const giftSnapshot = await transaction.get(giftReference);
    if (!giftSnapshot.exists()) throw new Error("O brinde não foi encontrado.");
    const savedGift = giftSnapshot.data();
    if (savedGift.status !== "active") {
      throw new Error("Este brinde já foi cancelado.");
    }

    const productSnapshot = await transaction.get(productReference);
    if (!productSnapshot.exists()) {
      throw new Error("O produto do brinde não foi encontrado no estoque.");
    }
    const reversalSnapshot = await transaction.get(reversalReference);
    if (reversalSnapshot.exists()) {
      throw new Error("A devolução deste brinde já foi movimentada.");
    }

    const product = productSnapshot.data();
    const currentQuantity = Math.floor(Number(product.quantity) || 0);
    const count = validateGiftQuantity(savedGift.quantity, Number.MAX_SAFE_INTEGER);
    const nextQuantity = currentQuantity + count;

    transaction.update(productReference, {
      quantity: nextQuantity,
      updatedAt: serverTimestamp(),
    });
    transaction.update(giftReference, {
      status: "cancelled",
      cancelledAt: serverTimestamp(),
      cancelStockMovementId: reversalReference.id,
    });
    transaction.set(reversalReference, {
      type: "cancelamento_brinde",
      reason: "Cancelamento de brinde com devolução ao estoque",
      clientId: savedGift.clientId,
      productId: savedGift.productId,
      productName: savedGift.productName || product.name || "",
      quantity: count,
      previousQuantity: currentQuantity,
      newQuantity: nextQuantity,
      unitCost: savedGift.unitCost,
      totalCost: savedGift.totalCost,
      giftId: gift.id,
      createdAt: serverTimestamp(),
    });
  });
}
