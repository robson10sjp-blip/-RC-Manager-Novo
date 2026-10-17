import assert from "node:assert/strict";
import test from "node:test";
import { assertFirestoreWritable } from "./writePolicy.js";

test("allows Firestore mutations outside read-only preview mode", () => {
  assert.doesNotThrow(() => assertFirestoreWritable(false));
});

test("blocks Firestore mutations in read-only preview mode", () => {
  assert.throws(
    () => assertFirestoreWritable(true),
    /somente leitura/
  );
});
