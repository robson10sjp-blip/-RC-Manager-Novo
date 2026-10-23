import {
  doc,
  serverTimestamp,
} from "firebase/firestore";
import {
  deleteDoc,
  runTransaction,
  updateDoc,
} from "../firebase/firestoreAccess.js";

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
