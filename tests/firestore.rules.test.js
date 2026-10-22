import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const PROJECT_ID = "demo-rc-manager-rules";
const RULES_PATH = path.resolve(process.cwd(), "firestore.rules");
const USER_A = "uid-a";
const USER_B = "uid-b";

let testEnv;

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, "users", USER_A, "clients", "client-1"), {
      name: "Cliente A",
      city: "Tucumã – PA",
      totalDebt: 120,
      classification: "good",
    });
    await setDoc(doc(db, "users", USER_B, "clients", "client-b"), {
      name: "Cliente B",
      city: "Xinguara – PA",
      totalDebt: 0,
    });

    await setDoc(doc(db, "users", USER_A, "products", "product-1"), {
      code: "P1",
      name: "Produto A",
      quantity: 5,
      costPrice: 10,
      salePrice: 20,
    });

    await setDoc(doc(db, "users", USER_A, "sales", "sale-open"), {
      clientId: "client-1",
      items: [{ productId: "product-1", quantity: 1 }],
      total: 20,
      amountPaid: 0,
      pendingAmount: 20,
    });
    await setDoc(doc(db, "users", USER_A, "sales", "sale-paid"), {
      clientId: "client-1",
      items: [{ productId: "product-1", quantity: 1 }],
      total: 20,
      amountPaid: 20,
      pendingAmount: 0,
    });

    await setDoc(doc(db, "users", USER_A, "sales", "sale-open", "payments", "pay-1"), {
      value: 5,
      previousBalance: 20,
      remainingBalance: 15,
    });

    await setDoc(doc(db, "users", USER_A, "payables", "payable-1"), {
      supplierId: "supplier-1",
      totalAmount: 100,
      paidAmount: 0,
      balance: 100,
    });

    await setDoc(doc(db, "users", USER_A, "clientVisits", "visit-1"), {
      clientId: "client-1",
      status: "not_purchased",
    });
    await setDoc(doc(db, "users", USER_A, "clientGifts", "gift-1"), {
      clientId: "client-1",
      productId: "product-1",
      quantity: 1,
      status: "active",
    });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed();
});

after(async () => {
  await testEnv.cleanup();
});

test("denies unauthenticated reads", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "users", USER_A, "clients", "client-1")));
});

test("allows owner reads and blocks cross-user reads", async () => {
  const ownerDb = testEnv.authenticatedContext(USER_A).firestore();
  const intruderDb = testEnv.authenticatedContext(USER_B).firestore();

  await assertSucceeds(getDoc(doc(ownerDb, "users", USER_A, "clients", "client-1")));
  await assertFails(getDoc(doc(intruderDb, "users", USER_A, "clients", "client-1")));
});

test("blocks cross-user writes", async () => {
  const db = testEnv.authenticatedContext(USER_B).firestore();

  await assertFails(
    updateDoc(doc(db, "users", USER_A, "products", "product-1"), {
      quantity: 999,
    })
  );
});

test("validates product quantity as non-negative integer", async () => {
  const db = testEnv.authenticatedContext(USER_A).firestore();

  await assertSucceeds(
    updateDoc(doc(db, "users", USER_A, "products", "product-1"), {
      code: "P1",
      name: "Produto A",
      quantity: 3,
      costPrice: 10,
      salePrice: 20,
    })
  );

  await assertFails(
    updateDoc(doc(db, "users", USER_A, "products", "product-1"), {
      code: "P1",
      name: "Produto A",
      quantity: -1,
      costPrice: 10,
      salePrice: 20,
    })
  );
});

test("blocks deleting paid sales and allows deleting unpaid sales", async () => {
  const db = testEnv.authenticatedContext(USER_A).firestore();

  await assertFails(deleteDoc(doc(db, "users", USER_A, "sales", "sale-paid")));
  await assertSucceeds(deleteDoc(doc(db, "users", USER_A, "sales", "sale-open")));
});

test("keeps payment records immutable after creation", async () => {
  const db = testEnv.authenticatedContext(USER_A).firestore();

  await assertFails(
    updateDoc(doc(db, "users", USER_A, "sales", "sale-open", "payments", "pay-1"), {
      value: 10,
    })
  );
  await assertFails(
    deleteDoc(doc(db, "users", USER_A, "sales", "sale-open", "payments", "pay-1"))
  );
});

test("blocks writes to gated collections (visits/gifts)", async () => {
  const db = testEnv.authenticatedContext(USER_A).firestore();

  await assertFails(
    setDoc(doc(db, "users", USER_A, "clientVisits", "visit-2"), {
      clientId: "client-1",
      status: "not_purchased",
    })
  );
  await assertFails(
    setDoc(doc(db, "users", USER_A, "clientGifts", "gift-2"), {
      clientId: "client-1",
      productId: "product-1",
      quantity: 1,
      status: "active",
    })
  );
});

test("allows owner stock movement creation and blocks edits", async () => {
  const db = testEnv.authenticatedContext(USER_A).firestore();
  const stockMovements = collection(db, "users", USER_A, "stockMovements");

  const created = await assertSucceeds(
    addDoc(stockMovements, {
      productId: "product-1",
      type: "saida",
      quantity: 1,
      previousQuantity: 5,
      newQuantity: 4,
    })
  );

  await assertFails(
    updateDoc(created, {
      quantity: 3,
    })
  );
});

test("supports owner list queries and blocks listing other users", async () => {
  const ownerDb = testEnv.authenticatedContext(USER_A).firestore();
  const intruderDb = testEnv.authenticatedContext(USER_B).firestore();

  const ownSnapshot = await assertSucceeds(
    getDocs(collection(ownerDb, "users", USER_A, "clients"))
  );
  assert.equal(ownSnapshot.size, 1);

  await assertFails(getDocs(collection(intruderDb, "users", USER_A, "clients")));
});
