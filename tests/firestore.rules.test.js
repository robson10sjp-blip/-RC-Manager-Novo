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
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { createClientTrip, recordClientVisit } from "../src/services/clientRecords.js";
import { buildClientVisitSummary } from "../src/domain/clientRecords.js";

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

    // Registros legados: sem clientId/balanceModel/amountPaid, totalDebt em texto, produto sem preços.
    await setDoc(doc(db, "users", USER_A, "clients", "legacy-client"), {
      name: "Cliente Antiga",
      city: "Tucumã – PA",
      totalDebt: "80",
    });
    await setDoc(doc(db, "users", USER_A, "products", "legacy-product"), {
      name: "Produto Antigo",
      quantity: 4,
    });
    await setDoc(doc(db, "users", USER_A, "sales", "legacy-sale"), {
      items: [{ productId: "legacy-product", quantity: 1 }],
      total: 30,
      pendingAmount: 30,
    });
    await setDoc(doc(db, "users", USER_A, "pregoClients", "legacy-prego"), {
      clientId: "legacy-client",
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

test("blocks malformed visits and gated gifts", async () => {
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
  assert.equal(ownSnapshot.size, 2);

  await assertFails(getDocs(collection(intruderDb, "users", USER_A, "clients")));
});

const ownerDb = () => testEnv.authenticatedContext(USER_A).firestore();
const ref = (db, ...segments) => doc(db, "users", USER_A, ...segments);

test("sale flow: transaction with stock decrement, sale, initial payment and movement", async () => {
  const db = ownerDb();
  const saleRef = ref(db, "sales", "sale-new");
  const productRef = ref(db, "products", "product-1");
  const paymentRef = ref(db, "sales", "sale-new", "payments", "pay-init");
  const movementRef = doc(collection(db, "users", USER_A, "stockMovements"));

  await assertSucceeds(
    runTransaction(db, async (tx) => {
      const product = await tx.get(productRef);
      const quantity = product.data().quantity;
      tx.update(productRef, { quantity: quantity - 2, updatedAt: serverTimestamp() });
      tx.set(saleRef, {
        balanceModel: "per-sale",
        clientId: "client-1",
        items: [{ productId: "product-1", quantity: 2 }],
        total: 40,
        amountPaid: 10,
        pendingAmount: 30,
        createdAt: serverTimestamp(),
      });
      tx.set(paymentRef, {
        operationId: "op-1",
        saleId: "sale-new",
        clientId: "client-1",
        value: 10,
        previousBalance: 40,
        remainingBalance: 30,
        type: "initial",
        createdAt: serverTimestamp(),
      });
      tx.set(movementRef, {
        productId: "product-1",
        type: "saida",
        quantity: 2,
        previousQuantity: quantity,
        newQuantity: quantity - 2,
        createdAt: serverTimestamp(),
      });
    })
  );
});

test("sale flow: negative stock and inconsistent totals are rejected", async () => {
  const db = ownerDb();
  await assertFails(updateDoc(ref(db, "products", "product-1"), { quantity: -1 }));
  await assertFails(
    setDoc(ref(db, "sales", "bad"), {
      clientId: "client-1",
      items: [],
      total: 10,
      amountPaid: 0,
      pendingAmount: 50,
    })
  );
});

test("receipt flow (per-sale): update sale and create payment; reading sales for receipts", async () => {
  const db = ownerDb();
  await assertSucceeds(
    runTransaction(db, async (tx) => {
      tx.update(ref(db, "sales", "sale-open"), {
        amountPaid: 20,
        pendingAmount: 0,
        status: "paid",
        updatedAt: serverTimestamp(),
      });
      tx.set(ref(db, "sales", "sale-open", "payments", "pay-2"), {
        operationId: "op-2",
        saleId: "sale-open",
        clientId: "client-1",
        value: 15,
        previousBalance: 15,
        remainingBalance: 0,
        createdAt: serverTimestamp(),
      });
    })
  );
  await assertSucceeds(getDocs(collection(db, "users", USER_A, "sales")));
  await assertSucceeds(getDoc(ref(db, "sales", "sale-paid")));
  await assertSucceeds(
    getDocs(query(collection(db, "users", USER_A, "sales", "sale-open", "payments"), orderBy("createdAt")))
  );
});

test("receipt flow (legacy): client balance update + clients/*/payments history", async () => {
  const db = ownerDb();
  await assertSucceeds(
    runTransaction(db, async (tx) => {
      tx.update(ref(db, "clients", "client-1"), {
        totalDebt: 70,
        totalReceived: 50,
        status: "partial",
        updatedAt: serverTimestamp(),
      });
      tx.set(ref(db, "clients", "client-1", "payments", "hist-1"), {
        value: 50,
        previousBalance: 120,
        remainingBalance: 70,
        createdAt: serverTimestamp(),
      });
    })
  );
  await assertSucceeds(
    getDocs(query(collection(db, "users", USER_A, "clients", "client-1", "payments"), orderBy("createdAt")))
  );
});

test("legacy documents remain editable (classification, stock, sale edit, sale delete)", async () => {
  const db = ownerDb();
  await assertSucceeds(updateDoc(ref(db, "clients", "legacy-client"), { classification: "prego" }));
  await assertSucceeds(updateDoc(ref(db, "products", "legacy-product"), { quantity: 3 }));
  await assertSucceeds(updateDoc(ref(db, "sales", "legacy-sale"), { pendingAmount: 20, total: 20 }));
  await assertSucceeds(deleteDoc(ref(db, "sales", "legacy-sale")));
  await assertSucceeds(getDocs(collection(db, "users", USER_A, "pregoClients")));
  await assertFails(deleteDoc(ref(db, "pregoClients", "legacy-prego")));
  await assertFails(updateDoc(ref(db, "clients", "legacy-client"), { classification: "invalid" }));
});

test("client create/edit with new classification default", async () => {
  const db = ownerDb();
  await assertSucceeds(
    setDoc(ref(db, "clients", "new-client"), {
      name: "Maria da Silva",
      city: "Tucumã – PA",
      totalDebt: 0,
      classification: "unclassified",
      updatedAt: serverTimestamp(),
    })
  );
  await assertSucceeds(updateDoc(ref(db, "clients", "new-client"), { classification: "excellent" }));
});

test("stock flow: entry movement and Secretária RC writes", async () => {
  const db = ownerDb();
  await assertSucceeds(
    runTransaction(db, async (tx) => {
      tx.update(ref(db, "products", "product-1"), { quantity: 9, updatedAt: serverTimestamp() });
      tx.set(doc(collection(db, "users", USER_A, "stockMovements")), {
        productId: "product-1",
        productName: "Produto A",
        type: "entrada",
        quantity: 4,
        previousQuantity: 5,
        newQuantity: 9,
        reason: "Secretária RC",
        createdAt: serverTimestamp(),
      });
    })
  );
  await assertSucceeds(
    addDoc(collection(db, "users", USER_A, "expenses"), { description: "Gasolina", amount: 50 })
  );
  await assertSucceeds(
    addDoc(collection(db, "users", USER_A, "products"), {
      code: "N1",
      name: "Novo",
      quantity: 1,
      costPrice: 5,
      salePrice: 10,
    })
  );
});

test("payables flow: partial payment, check compensation and creation", async () => {
  const db = ownerDb();
  await assertSucceeds(
    runTransaction(db, async (tx) => {
      tx.update(ref(db, "payables", "payable-1"), { paidAmount: 40, balance: 60, status: "partial" });
      tx.set(ref(db, "payables", "payable-1", "payments", "check-compensation-i1"), {
        type: "check-compensation",
        amount: 40,
        createdAt: serverTimestamp(),
      });
    })
  );
  await assertSucceeds(
    setDoc(ref(db, "payables", "payable-2"), {
      supplierId: "supplier-1",
      totalAmount: 10,
      paidAmount: 0,
      balance: 10,
      installments: [],
    })
  );
  await assertFails(updateDoc(ref(db, "payables", "payable-1"), { balance: -5 }));
});

test("cross-user: second user cannot read, list, write or delete in any collection", async () => {
  const intruder = testEnv.authenticatedContext(USER_B).firestore();
  const names = [
    "clients",
    "products",
    "sales",
    "expenses",
    "suppliers",
    "payables",
    "stockMovements",
    "pregoClients",
    "clientVisits",
    "clientGifts",
    "trips",
  ];
  for (const name of names) {
    await assertFails(getDocs(collection(intruder, "users", USER_A, name)));
    await assertFails(getDoc(doc(intruder, "users", USER_A, name, "x")));
    await assertFails(setDoc(doc(intruder, "users", USER_A, name, "x"), { name: "x", city: "x" }));
    await assertFails(deleteDoc(doc(intruder, "users", USER_A, name, "x")));
  }
  await assertFails(getDocs(collection(intruder, "users", USER_A, "sales", "sale-open", "payments")));
  await assertFails(getDoc(doc(intruder, "users", USER_A)));
  await assertFails(getDocs(collection(intruder, "users")));
});

test("unknown paths and user root are denied even for the owner", async () => {
  const db = ownerDb();
  await assertFails(setDoc(doc(db, "users", USER_A), { x: 1 }));
  await assertFails(setDoc(ref(db, "unknownCollection", "x"), { x: 1 }));
  await assertFails(getDoc(doc(db, "other", "x")));
});

test("denies malformed visits and owner writes to gifts and pregoClients", async () => {
  const db = ownerDb();
  await assertFails(setDoc(ref(db, "pregoClients", "p1"), { clientId: "client-1" }));
  await assertFails(updateDoc(ref(db, "clientVisits", "visit-1"), { status: "purchased" }));
  await assertFails(updateDoc(ref(db, "clientGifts", "gift-1"), { status: "cancelled" }));
});

test("real visit service: mark, reload from another session, undo, counts and idempotent retry", async () => {
  const db = ownerDb();
  const trip = await createClientTrip({ db, userId: USER_A, name: "Rota Sul" });
  const input = {
    db, userId: USER_A, clientId: "client-1", city: "Tucumã",
    tripId: trip.id, tripName: trip.name, status: "not_purchased",
  };
  const originalClient = (await getDoc(ref(db, "clients", "client-1"))).data();
  const originalProduct = (await getDoc(ref(db, "products", "product-1"))).data();
  const originalSale = (await getDoc(ref(db, "sales", "sale-open"))).data();
  assert.equal(await assertSucceeds(recordClientVisit(input)), true);
  assert.equal(await assertSucceeds(recordClientVisit(input)), false);

  const reloadDb = ownerDb();
  const readRecords = async () => (await getDocs(collection(reloadDb, "users", USER_A, "clientVisits")))
    .docs.map((document) => ({ ...document.data(), id: document.id }));
  const clients = [{ id: "client-1", ...originalClient }];
  const summary = async (tripId, city = "Tucumã") => buildClientVisitSummary({
    clients, city, tripId, visitRecords: await readRecords(), sales: [],
  }).counts;
  assert.deepEqual(await summary(trip.id), { unvisited: 0, not_purchased: 1, bought: 0 });
  assert.deepEqual(await summary("trip-new"), { unvisited: 1, not_purchased: 0, bought: 0 });
  assert.deepEqual(await summary(trip.id, "Xinguara"), { unvisited: 0, not_purchased: 0, bought: 0 });
  const saved = (await readRecords()).find((record) => record.tripId === trip.id);
  assert.equal(saved.cityKey, "tucuma");
  assert.equal(saved.history.length, 1);
  await assertSucceeds(recordClientVisit({ ...input, status: "unvisited" }));
  assert.deepEqual(await summary(trip.id), { unvisited: 1, not_purchased: 0, bought: 0 });
  assert.equal((await readRecords()).find((record) => record.tripId === trip.id).history.length, 2);
  assert.deepEqual((await getDoc(ref(db, "clients", "client-1"))).data(), originalClient);
  assert.deepEqual((await getDoc(ref(db, "products", "product-1"))).data(), originalProduct);
  assert.deepEqual((await getDoc(ref(db, "sales", "sale-open"))).data(), originalSale);
});

test("equal-name new trips stay separate; sales and visits share the saved trip ID", async () => {
  const db = ownerDb();
  const first = await createClientTrip({ db, userId: USER_A, name: "3" });
  const second = await createClientTrip({ db, userId: USER_A, name: "3" });
  assert.notEqual(first.id, second.id);
  const visit = {
    db, userId: USER_A, clientId: "client-1", city: "Tucumã",
    tripId: first.id, tripName: first.name, status: "not_purchased",
  };
  await assertSucceeds(recordClientVisit(visit));
  await assertSucceeds(updateDoc(ref(db, "sales", "sale-open"), {
    tripId: first.id, tripName: first.name, tripCity: "Tucumã",
  }));
  const sales = [{ id: "sale-open", ...(await getDoc(ref(db, "sales", "sale-open"))).data() }];
  const records = (await getDocs(collection(db, "users", USER_A, "clientVisits")))
    .docs.map((document) => document.data());
  const input = {
    clients: [{ id: "client-1", city: "Tucumã" }], city: "Tucumã",
    visitRecords: records, sales,
  };
  assert.equal(buildClientVisitSummary({ ...input, tripId: first.id }).counts.bought, 1);
  assert.equal(buildClientVisitSummary({ ...input, tripId: second.id }).counts.unvisited, 1);
  await assertFails(updateDoc(ref(db, "sales", "sale-open"), { tripName: "Other label" }));
});

test("visit rules deny other users, malformed scope, identity changes, deletions and forged bought", async () => {
  const db = ownerDb();
  const trip = await createClientTrip({ db, userId: USER_A, name: "Rota" });
  await recordClientVisit({
    db, userId: USER_A, clientId: "client-1", city: "Tucumã",
    tripId: trip.id, tripName: trip.name, status: "not_purchased",
  });
  const snapshots = await getDocs(collection(db, "users", USER_A, "clientVisits"));
  const document = snapshots.docs.find((document) => document.data().tripId === trip.id);
  const visitRef = ref(db, "clientVisits", document.id);
  for (const change of [
    { status: "bought" }, { city: "Xinguara" }, { cityKey: "xinguara" },
    { clientId: "client-b" }, { tripId: "legacy-number-4" },
    { updatedAt: new Date(0) }, { amount: 50 },
  ]) {
    await assertFails(updateDoc(visitRef, { ...change, ...(change.updatedAt ? {} : { updatedAt: serverTimestamp() }) }));
  }
  await assertFails(deleteDoc(visitRef));
  await assertFails(setDoc(ref(db, "clientVisits", "missing-client"), {
    ...document.data(), clientId: "missing", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  for (const context of [testEnv.authenticatedContext(USER_B), testEnv.unauthenticatedContext()]) {
    const foreign = ref(context.firestore(), "clientVisits", document.id);
    await assertFails(getDoc(foreign));
    await assertFails(getDocs(collection(context.firestore(), "users", USER_A, "clientVisits")));
    await assertFails(setDoc(foreign, { ...document.data(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(foreign, { status: "unvisited", updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(foreign));
    await assertFails(setDoc(ref(context.firestore(), "trips", `trip-${crypto.randomUUID()}`), {
      name: "Foreign", createdAt: serverTimestamp(),
    }));
  }
  await assertFails(updateDoc(ref(db, "trips", trip.id), { name: "Renamed" }));
  await assertFails(deleteDoc(ref(db, "trips", trip.id)));
});

test("legacy labels allow canonical visit writes without modifying old visits or sales", async () => {
  const db = ownerDb();
  await assertSucceeds(recordClientVisit({
    db, userId: USER_A, clientId: "client-1", city: "Tucumã",
    tripId: "legacy-number-3", tripName: "3ª viagem", status: "not_purchased",
  }));
  assert.equal((await getDoc(ref(db, "clientVisits", "visit-1"))).data().tripId, undefined);
  assert.equal((await getDoc(ref(db, "sales", "sale-open"))).data().tripId, undefined);
});
