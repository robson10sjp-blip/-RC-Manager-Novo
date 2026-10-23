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
  writeBatch,
} from "firebase/firestore";
import { createClientTrip, recordClientVisit, recordClientGift, cancelClientGift } from "../src/services/clientRecords.js";
import { buildClientVisitSummary } from "../src/domain/clientRecords.js";
import {
  compensateSupplierCheck,
  correctSupplierCheck,
  correctSupplierPayment,
  editSupplierPurchase,
  issueSupplierCheck,
} from "../src/services/supplierPayables.js";
import { buildSupplierPayable } from "../src/domain/suppliers.js";

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

test("supplier purchase edits, payment corrections and check compensation are atomic and idempotent", async () => {
  const db = ownerDb();
  const trip2027 = await createClientTrip({
    db,
    userId: USER_A,
    name: "1ª viagem/2027",
  });
  const trip2028 = await createClientTrip({
    db,
    userId: USER_A,
    name: "1ª viagem/2028",
  });
  const otherUserDb = testEnv.authenticatedContext(USER_B).firestore();
  const privateTrip = await createClientTrip({
    db: otherUserDb,
    userId: USER_B,
    name: "2ª viagem/2027",
  });
  const payableRef = ref(db, "payables", "supplier-fake");
  const paymentsRef = collection(db, "users", USER_A, "payables", "supplier-fake", "payments");
  const purchase = buildSupplierPayable({
    supplier: { id: "supplier-fake", name: "Fornecedor Fictício" },
    description: "Compra fictícia",
    purchaseDate: "2026-10-01",
    totalAmount: 500,
    downPayment: 100,
    trip: trip2027,
    installments: [{
      id: "installment-1", amount: 400,
      dueDate: "2026-11-01", method: "boleto",
    }],
  });
  await assertSucceeds(setDoc(payableRef, purchase));
  const foreignTripPurchase = buildSupplierPayable({
    supplier: { id: "supplier-fake", name: "Fornecedor Fictício" },
    description: "Vínculo de outra conta",
    purchaseDate: "2026-10-01",
    totalAmount: 100,
    downPayment: 100,
    installments: [],
    trip: privateTrip,
  });
  await assertFails(setDoc(ref(db, "payables", "foreign-trip-purchase"), foreignTripPurchase));
  const savedPurchase = (await getDoc(payableRef)).data();
  assert.equal(savedPurchase.tripId, trip2027.id);
  assert.equal(savedPurchase.tripNumber, 1);
  assert.equal(savedPurchase.tripYear, 2027);
  await assertSucceeds(setDoc(doc(paymentsRef, "down-payment-1"), {
    type: "down-payment", amount: 100,
    date: new Date("2026-10-01T12:00:00Z"), method: "pix", allocations: [],
  }));

  const issue = {
    db, userId: USER_A, payableId: "supplier-fake", operationId: "issue-test-1",
    amount: 150, identification: "00981", bankAccount: "bb-pf",
    bankName: "Banco do Brasil", issueDate: "2026-10-02",
    expectedCompensationDate: "2026-11-10",
  };
  const firstIssue = await assertSucceeds(issueSupplierCheck(issue));
  const secondIssue = await assertSucceeds(issueSupplierCheck({
    ...issue,
    operationId: "issue-test-2",
    amount: 50,
    identification: "00982",
    bankAccount: "bb-pj",
  }));
  assert.notEqual(firstIssue.checkId, secondIssue.checkId);
  assert.equal((await assertSucceeds(issueSupplierCheck(issue))).alreadyRecorded, true);
  const reloadedPayable = (await getDoc(ref(ownerDb(), "payables", "supplier-fake"))).data();
  const check = reloadedPayable.installments.find((item) => item.id === firstIssue.checkId);
  assert.equal(reloadedPayable.installments.filter((item) => item.method === "cheque").length, 2);
  assert.equal(check.checkStatus, "issued");
  assert.equal(check.issueDate.toDate().toISOString().slice(0, 10), "2026-10-02");
  assert.equal(reloadedPayable.paidAmount, 100);
  assert.equal((await getDocs(paymentsRef)).size, 1);
  await assertSucceeds(correctSupplierCheck({
    db, userId: USER_A, payableId: "supplier-fake", installmentId: check.id,
    changes: {
      amount: 150, identification: "00981-CORR", bankAccount: "bb-pf",
      bankName: "Banco do Brasil", issueDate: new Date("2026-10-02T12:00:00Z"),
      expectedCompensationDate: new Date("2026-11-10T12:00:00Z"),
    },
  }));
  assert.equal((await getDocs(collection(db, "users", USER_A, "payables", "supplier-fake", "corrections"))).size, 1);

  await assertSucceeds(compensateSupplierCheck({
    db,
    userId: USER_A,
    payableId: "supplier-fake",
    installmentId: check.id,
    changedAt: new Date("2027-02-15T12:00:00Z"),
  }));
  await assertSucceeds(compensateSupplierCheck({
    db, userId: USER_A, payableId: "supplier-fake", installmentId: check.id,
  }));
  assert.equal((await getDocs(paymentsRef)).size, 2);
  const compensation = await getDoc(doc(paymentsRef, `check-compensation-${check.id}`));
  assert.equal(compensation.data().date.toDate().toISOString(), "2027-02-15T12:00:00.000Z");
  const afterCompensation = (await getDoc(payableRef)).data();
  assert.equal(afterCompensation.paidAmount, 250);
  assert.equal(afterCompensation.balance, 250);
  assert.equal(afterCompensation.installments.find((item) => item.id === check.id).checkStatus, "compensated");

  await assertSucceeds(editSupplierPurchase({
    db, userId: USER_A, payableId: "supplier-fake",
    changes: {
      description: "Compra fictícia corrigida", totalAmount: 600,
      purchaseDate: "2026-10-03", dueDate: "2026-12-01", paymentType: "credit",
      tripId: trip2028.id,
      tripName: trip2028.name,
      tripNumber: 1,
      tripYear: 2028,
    },
  }));
  const editedPayable = (await getDoc(payableRef)).data();
  assert.equal(editedPayable.totalAmount, 600);
  assert.equal(editedPayable.paidAmount, 250);
  assert.equal(editedPayable.balance, 350);
  assert.equal(editedPayable.tripId, trip2028.id);
  assert.equal(editedPayable.tripYear, 2028);
  assert.equal(editedPayable.installments.find((item) => item.id === check.id).amount, 150);
  assert.equal((await getDocs(collection(db, "users", USER_A, "payables", "supplier-fake", "corrections"))).size, 2);
  await assert.rejects(editSupplierPurchase({
    db, userId: USER_A, payableId: "supplier-fake",
    changes: {
      description: "Total abaixo do pago", totalAmount: 200,
      purchaseDate: "2026-10-03", dueDate: "2026-12-01", paymentType: "credit",
    },
  }), /abaixo do valor já pago/);

  const partialRef = doc(paymentsRef, "partial-1");
  const current = (await getDoc(payableRef)).data();
  await assertSucceeds(runTransaction(db, async (tx) => {
    tx.update(payableRef, {
      paidAmount: 300,
      balance: 300,
      status: "partial",
      installments: current.installments.map((item) =>
        item.id === "installment-1"
          ? { ...item, paidAmount: 50, status: "partial" }
          : item
      ),
    });
    tx.set(partialRef, {
      amount: 50, date: new Date("2026-10-04T12:00:00Z"), method: "pix",
      installmentId: "installment-1", allocations: [{ installmentId: "installment-1", amount: 50 }],
    });
  }));
  await assertSucceeds(correctSupplierPayment({
    db, userId: USER_A, payableId: "supplier-fake", paymentId: "partial-1",
    changes: {
      amount: 40, date: new Date("2026-10-05T12:00:00Z"), method: "pix",
      identification: "", installmentId: "installment-1",
    },
  }));
  const corrected = (await getDoc(payableRef)).data();
  const correctedPayment = (await getDoc(partialRef)).data();
  assert.equal(corrected.paidAmount, 290);
  assert.equal(corrected.balance, 310);
  assert.equal(correctedPayment.amount, 40);
  assert.equal((await getDocs(paymentsRef)).docs.reduce(
    (sum, item) => sum + Number(item.data().amount || 0), 0
  ), 290);
  assert.equal((await getDocs(paymentsRef)).size, 3);
  assert.equal((await getDocs(collection(db, "users", USER_A, "payables", "supplier-fake", "corrections"))).size, 3);
  await assertFails(updateDoc(payableRef, {
    description: "Sem correção auditada",
    totalAmount: 601,
    paidAmount: 290,
    balance: 311,
  }));
  await assertFails(updateDoc(partialRef, { amount: 45 }));
  const auditSnapshot = await getDocs(collection(db, "users", USER_A, "payables", "supplier-fake", "corrections"));
  await assertFails(updateDoc(auditSnapshot.docs[0].ref, { type: "forged" }));
  await assertFails(deleteDoc(auditSnapshot.docs[0].ref));
  await assertFails(getDoc(ref(testEnv.authenticatedContext(USER_B).firestore(), "payables", "supplier-fake")));
  await assertFails(getDocs(collection(testEnv.authenticatedContext(USER_B).firestore(),
    "users", USER_A, "payables", "supplier-fake", "corrections")));
  await assertFails(updateDoc(doc(testEnv.authenticatedContext(USER_B).firestore(),
    "users", USER_A, "payables", "supplier-fake"), { totalAmount: 9999 }));
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

test("blocks malformed visits and gifts without atomic stock movement", async () => {
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
    addDoc(collection(db, "users", USER_A, "expenses"), {
      category: "pessoal",
      kind: "personal_withdrawal",
      value: 50,
      expenseDate: new Date("2026-10-23T12:00:00"),
      city: "",
      tripNumber: null,
      paymentMethod: "pix",
    })
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

test("denies malformed visits, incomplete gift cancellations and legacy prego writes", async () => {
  const db = ownerDb();
  await assertFails(setDoc(ref(db, "pregoClients", "p1"), { clientId: "client-1" }));
  await assertFails(updateDoc(ref(db, "clientVisits", "visit-1"), { status: "purchased" }));
  await assertFails(updateDoc(ref(db, "clientGifts", "gift-1"), { status: "cancelled" }));
});

async function giftInput(db, overrides = {}) {
  const trip = await createClientTrip({ db, userId: USER_A, name: "Brindes outubro" });
  return {
    db, userId: USER_A, operationId: crypto.randomUUID(),
    clientId: "client-1", productId: "product-1", quantity: 2,
    tripId: trip.id, tripName: trip.name, tripCity: "Tucumã",
    ...overrides,
  };
}

test("gift service: register, reload history and preserve financial records, visits and classification", async () => {
  const db = ownerDb();
  const input = await giftInput(db);
  const unchangedPaths = [
    ["clients", "client-1"], ["sales", "sale-open"], ["sales", "sale-paid"],
    ["payables", "payable-1"], ["clientVisits", "visit-1"],
  ];
  const before = await Promise.all(unchangedPaths.map(async (path) => (await getDoc(ref(db, ...path))).data()));
  const id = await assertSucceeds(recordClientGift(input));
  const reloaded = ownerDb();
  const gift = (await getDoc(ref(reloaded, "clientGifts", id))).data();
  assert.equal(gift.clientId, input.clientId);
  assert.equal(gift.tripId, input.tripId);
  assert.equal(gift.tripCity, "Tucumã – PA");
  assert.equal(gift.cityKey, "tucuma");
  assert.equal(gift.totalCost, 20);
  assert.equal(gift.status, "active");
  assert.equal((await getDoc(ref(reloaded, "products", "product-1"))).data().quantity, 3);
  const movement = (await getDoc(ref(reloaded, "stockMovements", gift.stockMovementId))).data();
  assert.equal(movement.giftId, id);
  assert.equal(movement.previousQuantity, 5);
  assert.equal(movement.newQuantity, 3);
  assert.equal(movement.tripId, input.tripId);
  assert.ok((await getDocs(collection(reloaded, "users", USER_A, "clientGifts"))).docs.some((d) => d.id === id));
  for (let i = 0; i < unchangedPaths.length; i++) {
    assert.deepEqual((await getDoc(ref(db, ...unchangedPaths[i]))).data(), before[i]);
  }
  assert.equal((await getDocs(collection(db, "users", USER_A, "expenses"))).size, 0);
});

test("gift correction: cancel persisted product, restore once and register corrected delivery", async () => {
  const db = ownerDb();
  const input = await giftInput(db);
  const id = await recordClientGift(input);
  // The caller's product must never determine which stock is returned.
  await assertSucceeds(cancelClientGift({ db, userId: USER_A, gift: { id, productId: "not-the-product" } }));
  await assertSucceeds(cancelClientGift({ db, userId: USER_A, gift: { id } }));
  assert.equal((await getDoc(ref(db, "products", "product-1"))).data().quantity, 5);
  const cancelled = (await getDoc(ref(db, "clientGifts", id))).data();
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.quantity, 2);
  assert.equal((await getDoc(ref(db, "stockMovements", cancelled.cancelStockMovementId))).data().quantity, 2);
  const correctedId = await recordClientGift({ ...input, operationId: crypto.randomUUID(), quantity: 1 });
  assert.notEqual(correctedId, id);
  assert.equal((await getDoc(ref(ownerDb(), "products", "product-1"))).data().quantity, 4);
  assert.equal((await getDoc(ref(ownerDb(), "clientGifts", correctedId))).data().quantity, 1);
  assert.equal((await getDocs(collection(db, "users", USER_A, "stockMovements"))).size, 3);
});

test("gift transactions: concurrent conflicts never duplicate stock; explicit retry is idempotent", async () => {
  const db = ownerDb();
  const input = await giftInput(db);
  const attempts = await Promise.allSettled([
    recordClientGift(input), recordClientGift({ ...input, db: ownerDb() }),
  ]);
  assert.ok(attempts.some((result) => result.status === "fulfilled"));
  for (const result of attempts.filter((result) => result.status === "rejected")) {
    assert.equal(result.reason.code, "permission-denied");
  }
  const id = await recordClientGift(input);
  assert.equal(id, `gift-${input.operationId}`);
  assert.equal((await getDoc(ref(db, "products", "product-1"))).data().quantity, 3);
  await assert.rejects(recordClientGift({ ...input, quantity: 1 }), /já utilizado/);
  const cancellations = await Promise.allSettled([
    cancelClientGift({ db, userId: USER_A, gift: { id } }),
    cancelClientGift({ db: ownerDb(), userId: USER_A, gift: { id } }),
  ]);
  assert.ok(cancellations.some((result) => result.status === "fulfilled"));
  for (const result of cancellations.filter((result) => result.status === "rejected")) {
    assert.equal(result.reason.code, "permission-denied");
  }
  await cancelClientGift({ db, userId: USER_A, gift: { id } });
  assert.equal((await getDoc(ref(db, "products", "product-1"))).data().quantity, 5);
  assert.equal((await getDocs(collection(db, "users", USER_A, "stockMovements"))).size, 2);
});

test("gift transactions: concurrent deliveries cannot overdraw stock", async () => {
  const db = ownerDb();
  const input = await giftInput(db, { quantity: 4 });
  const outcomes = await Promise.allSettled([
    recordClientGift(input), recordClientGift({ ...input, operationId: crypto.randomUUID(), db: ownerDb() }),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = outcomes.find((r) => r.status === "rejected");
  assert.ok(rejected.reason.code === "permission-denied" || /superar o estoque/.test(rejected.reason.message));
  await assert.rejects(recordClientGift({ ...input, operationId: crypto.randomUUID() }), /superar o estoque/);
  assert.equal((await getDoc(ref(db, "products", "product-1"))).data().quantity, 1);
  assert.equal((await getDocs(collection(db, "users", USER_A, "stockMovements"))).size, 1);
});

test("gift service rejects invalid quantity, missing client/product, wrong city and unknown trip", async () => {
  const db = ownerDb();
  const input = await giftInput(db);
  for (const quantity of [0, -1, 1.5, 6]) {
    await assert.rejects(recordClientGift({ ...input, quantity }), /quantidade/);
  }
  await assert.rejects(recordClientGift({ ...input, clientId: "missing" }), /cliente não existe/);
  await assert.rejects(recordClientGift({ ...input, productId: "missing" }), /produto selecionado não existe/);
  await assert.rejects(recordClientGift({ ...input, tripCity: "Xinguara" }), /não pertence/);
  await assertFails(recordClientGift({ ...input, tripId: `trip-${crypto.randomUUID()}` }));
  assert.equal((await getDoc(ref(db, "products", "product-1"))).data().quantity, 5);
});

test("gift rules require atomic stock and matching movement; reject financial mutations and forged cancellations", async () => {
  const db = ownerDb();
  const id = await recordClientGift(await giftInput(db));
  const saved = (await getDoc(ref(db, "clientGifts", id))).data();
  const clonedId = "gift-forged";
  const forged = {
    ...saved, stockMovementId: `gift-${clonedId}`, giftDate: serverTimestamp(), createdAt: serverTimestamp(),
  };
  await assertFails(setDoc(ref(db, "clientGifts", clonedId), forged));
  const batch = writeBatch(db);
  batch.set(ref(db, "clientGifts", clonedId), forged);
  batch.update(ref(db, "products", "product-1"), { quantity: 1, updatedAt: serverTimestamp() });
  await assertFails(batch.commit()); // No matching movement: neither write may commit.
  assert.equal((await getDoc(ref(db, "products", "product-1"))).data().quantity, 3);
  for (const change of [
    { quantity: 99 }, { clientId: "client-b" }, { productId: "legacy-product" },
    { tripId: "legacy-number-4" }, { tripCity: "Xinguara" }, { totalCost: 0 },
    { status: "cancelled", cancelledAt: serverTimestamp(), cancelStockMovementId: `gift-cancel-${id}` },
  ]) await assertFails(updateDoc(ref(db, "clientGifts", id), change));
  await assertFails(deleteDoc(ref(db, "clientGifts", id)));
  await assertFails(setDoc(ref(db, "stockMovements", "gift-unlinked"), {
    type: "brinde", giftId: id, productId: "product-1", quantity: 2,
    previousQuantity: 3, newQuantity: 1, unitCost: 10, totalCost: 20, createdAt: serverTimestamp(),
  }));
  await cancelClientGift({ db, userId: USER_A, gift: { id } });
  await assertFails(updateDoc(ref(db, "clientGifts", id), { status: "active" }));
  await assertFails(updateDoc(ref(db, "stockMovements", saved.stockMovementId), { quantity: 1 }));
  await assertFails(deleteDoc(ref(db, "stockMovements", `gift-cancel-${id}`)));
});

test("gift permissions: another user or unauthenticated session cannot access a valid gift", async () => {
  const db = ownerDb();
  const input = await giftInput(db);
  const id = await recordClientGift(input);
  const data = (await getDoc(ref(db, "clientGifts", id))).data();
  for (const context of [testEnv.authenticatedContext(USER_B), testEnv.unauthenticatedContext()]) {
    const foreign = context.firestore();
    await assertFails(getDoc(ref(foreign, "clientGifts", id)));
    await assertFails(getDocs(collection(foreign, "users", USER_A, "clientGifts")));
    await assertFails(setDoc(ref(foreign, "clientGifts", "copy"), data));
    await assertFails(updateDoc(ref(foreign, "clientGifts", id), { status: "cancelled" }));
    await assertFails(deleteDoc(ref(foreign, "clientGifts", id)));
    await assertFails(cancelClientGift({ db: foreign, userId: USER_A, gift: { id } }));
  }
  await assert.rejects(recordClientGift({
    ...input, db: testEnv.authenticatedContext(USER_B).firestore(), userId: USER_B,
    clientId: "client-1", // A client from A cannot be used in B's own namespace either.
  }), /cliente não existe/);
  assert.equal((await getDoc(ref(db, "products", "product-1"))).data().quantity, 3);
});

test("gift rules validate the complete atomic payload rather than trusting the client service", async () => {
  const db = ownerDb();
  const input = await giftInput(db);
  async function deliver({ giftChange = {}, movementChange = {}, quantityAfter = 3 } = {}) {
    const id = `gift-${crypto.randomUUID()}`;
    const movementId = `gift-${id}`;
    const gift = {
      clientId: "client-1", productId: "product-1", productName: "Produto A",
      tripId: input.tripId, tripName: input.tripName, tripCity: "Tucumã – PA", cityKey: "tucuma",
      quantity: 2, unitCost: 10, totalCost: 20, status: "active",
      stockMovementId: movementId, giftDate: serverTimestamp(), createdAt: serverTimestamp(), ...giftChange,
    };
    const batch = writeBatch(db);
    batch.set(ref(db, "clientGifts", id), gift);
    batch.update(ref(db, "products", "product-1"), { quantity: quantityAfter, updatedAt: serverTimestamp() });
    batch.set(ref(db, "stockMovements", movementId), {
      type: "brinde", giftId: id, clientId: gift.clientId, productId: gift.productId,
      productName: gift.productName, tripId: gift.tripId, tripCity: gift.tripCity,
      quantity: gift.quantity, unitCost: gift.unitCost, totalCost: gift.totalCost,
      previousQuantity: 5, newQuantity: quantityAfter, createdAt: serverTimestamp(), ...movementChange,
    });
    return batch.commit();
  }
  for (const giftChange of [
    { quantity: 0 }, { quantity: 1.5 }, { quantity: 6 },
    { unitCost: 1, totalCost: 2 }, { totalCost: 99 },
    { clientId: "client-b" }, { tripCity: "Xinguara" }, { tripId: "missing-trip" },
    { tripName: "Wrong trip name" }, { status: "cancelled" }, { amountPaid: 10 },
  ]) await assertFails(deliver({ giftChange }));
  await assertFails(deliver({ movementChange: { quantity: 1 } }));
  await assertFails(deliver({ movementChange: { tripId: "legacy-number-4" } }));
  await assertFails(deliver({ quantityAfter: 4 }));
  await assertFails(deliver({ quantityAfter: -1 }));
  assert.equal((await getDoc(ref(db, "products", "product-1"))).data().quantity, 5);
  await assertSucceeds(deliver());
});

test("gift cost rounding matches the application and cancelling keeps historical cost after price changes", async () => {
  const db = ownerDb();
  await updateDoc(ref(db, "products", "product-1"), { costPrice: 1.005 });
  const input = await giftInput(db, { quantity: 1 });
  const id = await assertSucceeds(recordClientGift(input));
  assert.equal((await getDoc(ref(db, "clientGifts", id))).data().totalCost, 1.01);
  await updateDoc(ref(db, "products", "product-1"), { costPrice: 15 });
  await assertSucceeds(cancelClientGift({ db, userId: USER_A, gift: { id } }));
  const reversal = (await getDoc(ref(db, "stockMovements", `gift-cancel-${id}`))).data();
  assert.equal(reversal.totalCost, 1.01);
  assert.equal(reversal.unitCost, 1.005);
  assert.equal((await getDoc(ref(db, "products", "product-1"))).data().costPrice, 15);
});

test("legacy gift history without tripId remains readable and can be reversed without migration", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await updateDoc(ref(db, "products", "product-1"), { quantity: 3 });
    await setDoc(ref(db, "clientGifts", "legacy-complete"), {
      clientId: "client-1", productId: "product-1", productName: "Produto A",
      quantity: 2, tripName: "3ª viagem", tripCity: "Tucumã – PA",
      status: "active", unitCost: 10, totalCost: 20,
      giftDate: new Date("2026-10-01T12:00:00Z"),
      createdAt: new Date("2026-10-01T12:00:00Z"),
    });

  });
  const db = ownerDb();
  const before = (await getDoc(ref(db, "clientGifts", "legacy-complete"))).data();
  await assertSucceeds(cancelClientGift({ db, userId: USER_A, gift: { id: "legacy-complete" } }));
  const after = (await getDoc(ref(db, "clientGifts", "legacy-complete"))).data();
  assert.equal(after.tripId, undefined);
  assert.equal(after.tripName, before.tripName);
  assert.deepEqual(after.giftDate, before.giftDate);
  assert.equal(after.status, "cancelled");
  assert.equal((await getDoc(ref(db, "products", "product-1"))).data().quantity, 5);
});

test("calendar actions persist chosen dates without a trip, preserve client city and allow undo/cancellation", async () => {
      const db = ownerDb();
      const input = {
        db, userId: USER_A, clientId: "client-1", city: "Tucumã",
        actionDate: "2026-10-20", status: "not_purchased",
      };
      await assertSucceeds(recordClientVisit(input));
      await assertSucceeds(recordClientVisit({ ...input, actionDate: "2026-10-21" }));
      const reload = ownerDb();
      const visits = (await getDocs(collection(reload, "users", USER_A, "clientVisits"))).docs.map((d) => d.data());
      const dated = visits.filter((v) => v.actionDate);
      assert.equal(dated.length, 2);
      assert.ok(dated.every((v) => v.tripId === "" && v.city === "Tucumã – PA"));
      await assertSucceeds(recordClientVisit({ ...input, status: "unvisited" }));
      const gift = {
        db, userId: USER_A, operationId: crypto.randomUUID(), clientId: "client-1",
        productId: "product-1", quantity: 1, tripCity: "Tucumã", actionDate: "2026-10-19",
      };
      const id = await assertSucceeds(recordClientGift(gift));
      const saved = (await getDoc(ref(reload, "clientGifts", id))).data();
      assert.equal(saved.actionDate, "2026-10-19");
      assert.equal(saved.tripId, "");
      assert.equal(saved.tripName, "");
      assert.equal(saved.tripCity, "Tucumã – PA");
      await assertSucceeds(recordClientGift(gift));
      await assertSucceeds(cancelClientGift({ db, userId: USER_A, gift: { id } }));
      assert.equal((await getDoc(ref(db, "products", "product-1"))).data().quantity, 5);
      await assert.rejects(recordClientVisit({ ...input, actionDate: "2026-02-30" }), /data válida/);
      await assert.rejects(recordClientGift({ ...gift, actionDate: "" }), /data válida/);
      const invalid = { ...saved, actionDate: "not-a-date", createdAt: serverTimestamp(), giftDate: serverTimestamp() };
      await assertFails(setDoc(ref(db, "clientGifts", "invalid-date"), invalid));
      const visitSnapshot = await getDocs(collection(db, "users", USER_A, "clientVisits"));
      const visit = visitSnapshot.docs.find((d) => d.data().actionDate === input.actionDate);
      await assertFails(updateDoc(visit.ref, { actionDate: "2026-02-30", updatedAt: serverTimestamp() }));
      await assertFails(getDoc(doc(testEnv.authenticatedContext(USER_B).firestore(),
        "users", USER_A, "clientVisits", visit.id)));
      await assertFails(getDoc(doc(testEnv.authenticatedContext(USER_B).firestore(),
        "users", USER_A, "clientGifts", id)));
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
