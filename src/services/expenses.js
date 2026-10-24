import {
  doc,
  serverTimestamp,
} from "firebase/firestore";
import {
  deleteDoc,
  runTransaction,
  updateDoc,
} from "../firebase/firestoreAccess.js";
import { buildExpenseTripCorrection } from "../domain/expenseTripCorrection.js";
import { getTripNumberYear } from "../domain/tripIdentity.js";

export async function correctExpenseTrip({ db, userId, expected, destination }) {
  if (!userId || userId.includes("/") || !destination?.id || destination.id.includes("/")) {
    throw new Error("Entre na conta e confirme um cadastro de viagem válido.");
  }
  const reference = ownerExpenseReference(db, userId, expected.id);
  return runTransaction(db, async (transaction) => {
    const expenseSnapshot = await transaction.get(reference);
    const tripSnapshot = await transaction.get(doc(db, "users", userId, "trips", destination.id));
    if (!expenseSnapshot.exists() || !tripSnapshot.exists()) {
      throw new Error("Lançamento ou viagem não encontrado. Atualize a revisão.");
    }
    const currentDestination = { ...tripSnapshot.data(), id: tripSnapshot.id };
    const beforeIdentity = getTripNumberYear(destination);
    const identity = getTripNumberYear(currentDestination);
    if (identity.tripNumber !== beforeIdentity.tripNumber || identity.tripYear !== beforeIdentity.tripYear) {
      throw new Error("O destino mudou desde a prévia. Confira a viagem novamente.");
    }
    const patch = buildExpenseTripCorrection({
      expense: { ...expenseSnapshot.data(), id: expenseSnapshot.id },
      expected, destination: currentDestination, userId,
    });
    transaction.update(reference, { ...patch, updatedAt: serverTimestamp() });
  });
}

function ownerExpenseReference(db, userId, expenseId) {
  if (!userId || !expenseId) {
    throw new Error("Não foi possível identificar o lançamento.");
  }
  return doc(db, "users", userId, "expenses", expenseId);
}

export async function createExpense({
  db,
  userId,
  expenseId,
  expense,
}) {
  const reference = ownerExpenseReference(db, userId, expenseId);
  return runTransaction(db, async (transaction) => {
    const existing = await transaction.get(reference);
    if (existing.exists()) return true;
    transaction.set(reference, {
      ...expense,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return false;
  });
}

export async function updateExpense({ db, userId, expenseId, expense }) {
  return updateDoc(ownerExpenseReference(db, userId, expenseId), {
    ...expense,
    updatedAt: serverTimestamp(),
  });
}

export async function removeExpense({ db, userId, expenseId }) {
  return deleteDoc(ownerExpenseReference(db, userId, expenseId));
}
