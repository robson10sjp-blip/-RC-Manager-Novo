export function isFirestoreReadOnly() {
  return import.meta.env?.MODE === "readonly";
}

export function assertFirestoreWritable(readOnly = isFirestoreReadOnly()) {
  if (readOnly) {
    throw new Error(
      "A prévia está em modo somente leitura. Nenhuma gravação no Firestore foi permitida."
    );
  }
}
