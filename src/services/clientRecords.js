import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { runTransaction } from "../firebase/firestoreAccess.js";
import {
  calculateGiftCost,
  createVisitRecordId,
  validateGiftQuantity,
  validateActionDate,
} from "../domain/clientRecords.js";
import { getClientCityKey } from "../domain/clientCities.js";
import { buildNewTrip, getTripNumberYear } from "../domain/tripIdentity.js";

export const CLIENT_GIFT_WRITES_ENABLED = true;
export const CLIENT_VISIT_WRITES_ENABLED = true;

export async function createClientTrip({ db, userId, tripNumber, tripYear }) {
  if (!userId) throw new Error("Entre no sistema para criar uma viagem.");
  const trip = buildNewTrip({ tripNumber, tripYear });
  const existing = await getDocs(collection(db, "users", userId, "trips"));
  const matching = existing.docs.filter((document) => {
    const identity = getTripNumberYear({ ...document.data(), id: document.id });
    return identity.tripNumber === trip.tripNumber && identity.tripYear === trip.tripYear;
  });
  if (matching.length === 1) {
    return { ...matching[0].data(), id: matching[0].id, registered: true };
  }
  if (matching.length > 1) {
    throw new Error("Há mais de um cadastro com esse número e ano. Selecione explicitamente o ID existente.");
  }
  const reference = doc(db, "users", userId, "trips", trip.id);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists()) {
      throw new Error("Já existe uma viagem com esse número e ano. Selecione o cadastro existente.");
    }
    transaction.set(reference, {
      name: trip.name,
      tripNumber: trip.tripNumber,
      tripYear: trip.tripYear,
      createdAt: serverTimestamp(),
    });
  });
  return trip;
}

export async function recordClientVisit({
  db,
  userId,
  clientId,
  city,
  tripId = "",
  tripName = "",
  actionDate,
  status,
  existingRecord = null,
}) {
  if (!["not_purchased", "unvisited"].includes(status)) {
    throw new Error("Situação de visita inválida.");
  }
  if (actionDate !== undefined) validateActionDate(actionDate);
  if (!userId || (!actionDate && (!tripName?.trim() || !tripId))) {
    throw new Error("Selecione uma viagem confirmada ou uma data no calendário e entre no sistema.");
  }
  if (existingRecord && (existingRecord.clientId !== clientId ||
    getClientCityKey(existingRecord.city) !== getClientCityKey(city))) {
    throw new Error("O histórico selecionado não pertence à cliente/cidade.");
  }
  const recordId = existingRecord?.id || createVisitRecordId(clientId, tripId, city, actionDate);
  const reference = doc(db, "users", userId, "clientVisits", recordId);

  return runTransaction(db, async (transaction) => {
    const clientSnapshot = await transaction.get(doc(db, "users", userId, "clients", clientId));
    if (!clientSnapshot.exists() ||
      getClientCityKey(clientSnapshot.data().city) !== getClientCityKey(city)) {
      throw new Error("A cliente não existe ou não pertence à cidade selecionada.");
    }
    const snapshot = await transaction.get(reference);
    const saved = snapshot.exists() ? snapshot.data() : {};
    if (existingRecord && (!snapshot.exists() || saved.clientId !== clientId ||
      saved.tripId !== existingRecord.tripId || saved.tripName !== existingRecord.tripName)) {
      throw new Error("O histórico de visita mudou. Atualize a consulta antes de confirmar.");
    }
    if (saved.status === status) return false;

    transaction.set(
      reference,
      {
        clientId,
        city: clientSnapshot.data().city,
        cityKey: getClientCityKey(city),
        tripId: existingRecord ? saved.tripId || "" : tripId,
        tripName: existingRecord ? saved.tripName || "" : tripName.trim(),
        ...(actionDate ? { actionDate } : {}),
        status,
        history: [
          ...(Array.isArray(saved.history) ? saved.history : []),
          { status, changedAt: new Date().toISOString(), ...(actionDate ? { actionDate } : {}) },
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
  tripId = "",
  tripName = "",
  actionDate,
  tripCity,
}) {
  if (!userId || !clientId || !productId || !operationId) {
    throw new Error("Cliente, produto, usuário e identificador da entrega são obrigatórios.");
  }
  if (actionDate !== undefined) validateActionDate(actionDate);
  if ((!actionDate && (!tripId || !tripName?.trim())) || !getClientCityKey(tripCity)) {
    throw new Error("Selecione a cidade e uma viagem confirmada antes de registrar o brinde.");
  }
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
        savedGift.tripId !== tripId ||
        savedGift.tripName !== tripName ||
        (actionDate && savedGift.actionDate !== actionDate) ||
        getClientCityKey(savedGift.tripCity) !== getClientCityKey(tripCity)
      ) {
        throw new Error("Identificador de entrega já utilizado com outros dados.");
      }
      return;
    }
    if (existingMovement.exists()) {
      throw new Error("Já existe uma movimentação com este identificador.");
    }

    const clientSnapshot = await transaction.get(doc(db, "users", userId, "clients", clientId));
    if (!clientSnapshot.exists() ||
      getClientCityKey(clientSnapshot.data().city) !== getClientCityKey(tripCity)) {
      throw new Error("A cliente não existe ou não pertence à cidade selecionada.");
    }
    const productSnapshot = await transaction.get(productReference);
    if (!productSnapshot.exists()) {
      throw new Error("O produto selecionado não existe mais no estoque.");
    }
    const product = productSnapshot.data();
    if (!Number.isInteger(product.quantity) || product.quantity < 0) {
      throw new Error("O estoque deste produto precisa ter uma quantidade inteira válida antes da entrega.");
    }
    const available = product.quantity;
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
      tripId,
      tripName: tripName.trim(),
      ...(actionDate ? { actionDate } : {}),
      tripCity: clientSnapshot.data().city,
      cityKey: getClientCityKey(tripCity),
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
      tripId,
      tripCity: clientSnapshot.data().city,
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
  if (!userId || !gift?.id) {
    throw new Error("Usuário e identificador do brinde são obrigatórios.");
  }
  const giftReference = doc(db, "users", userId, "clientGifts", gift.id);
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
    const reversalSnapshot = await transaction.get(reversalReference);
    if (savedGift.status === "cancelled" &&
      savedGift.cancelStockMovementId === reversalReference.id && reversalSnapshot.exists()) {
      return;
    }
    if (savedGift.status !== "active") {
      throw new Error("Este brinde já foi cancelado.");
    }

    const productReference = doc(db, "users", userId, "products", savedGift.productId);
    const productSnapshot = await transaction.get(productReference);
    if (!productSnapshot.exists()) {
      throw new Error("O produto do brinde não foi encontrado no estoque.");
    }
    if (reversalSnapshot.exists()) {
      throw new Error("A devolução deste brinde já foi movimentada.");
    }

    const product = productSnapshot.data();
    if (!Number.isInteger(product.quantity) || product.quantity < 0) {
      throw new Error("O estoque deste produto precisa ter uma quantidade inteira válida antes da devolução.");
    }
    const currentQuantity = product.quantity;
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
      ...(savedGift.tripId ? { tripId: savedGift.tripId } : {}),
      ...(savedGift.tripCity ? { tripCity: savedGift.tripCity } : {}),
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
