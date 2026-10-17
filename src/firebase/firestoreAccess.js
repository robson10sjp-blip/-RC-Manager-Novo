import {
  addDoc as firebaseAddDoc,
  deleteDoc as firebaseDeleteDoc,
  runTransaction as firebaseRunTransaction,
  setDoc as firebaseSetDoc,
  updateDoc as firebaseUpdateDoc,
} from "firebase/firestore";
import { assertFirestoreWritable } from "./writePolicy";

export function addDoc(...args) {
  assertFirestoreWritable();
  return firebaseAddDoc(...args);
}

export function deleteDoc(...args) {
  assertFirestoreWritable();
  return firebaseDeleteDoc(...args);
}

export function runTransaction(...args) {
  assertFirestoreWritable();
  return firebaseRunTransaction(...args);
}

export function setDoc(...args) {
  assertFirestoreWritable();
  return firebaseSetDoc(...args);
}

export function updateDoc(...args) {
  assertFirestoreWritable();
  return firebaseUpdateDoc(...args);
}
