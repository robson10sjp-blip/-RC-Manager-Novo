import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createBackupJson } from "../src/backup-core.mjs";
import { decryptBackupBuffer, encryptJsonToFile } from "../src/crypto.mjs";
import { createFirestoreReader } from "../src/firestore-reader.mjs";

class FakeFirestore {
  constructor(collectionPaths, documents) {
    this.collectionPaths = collectionPaths;
    this.documents = documents;
    this.pageReads = [];
  }

  listCollections() {
    return Promise.resolve(
      this.collectionPaths
        .filter((path) => !path.includes("/"))
        .map((path) => ({ path }))
    );
  }

  collection(path) {
    const query = new FakeQuery(this, path);
    query.listDocuments = () => {
      const paths = this.documents
        .filter(
          (document) =>
            document.path.startsWith(`${path}/`) &&
            document.path.split("/").length === path.split("/").length + 1
        )
        .map((document) => document.path);

      for (const childCollection of this.collectionPaths) {
        if (!childCollection.startsWith(`${path}/`)) continue;
        const documentId = childCollection.slice(`${path}/`.length).split("/")[0];
        const documentPath = `${path}/${documentId}`;
        if (documentPath.split("/").length === path.split("/").length + 1) {
          paths.push(documentPath);
        }
      }

      return Promise.resolve(
        [...new Set(paths)].sort().map((documentPath) => ({ path: documentPath }))
      );
    };

    return query;
  }

  doc(path) {
    const prefix = `${path}/`;
    const segments = path.split("/").length;

    return {
      listCollections: () =>
        Promise.resolve(
          this.collectionPaths
            .filter(
              (collectionPath) =>
                collectionPath.startsWith(prefix) &&
                collectionPath.split("/").length === segments + 1
            )
            .map((collectionPath) => ({ path: collectionPath }))
        ),
    };
  }
}

class FakeQuery {
  constructor(firestore, collectionPath) {
    this.firestore = firestore;
    this.collectionPath = collectionPath;
    this.pageSize = Infinity;
    this.cursorPath = null;
  }

  orderBy(field) {
    assert.equal(field, "__name__");
    return this;
  }

  limit(pageSize) {
    this.pageSize = pageSize;
    return this;
  }

  startAfter(document) {
    this.cursorPath = document.ref.path;
    return this;
  }

  async get() {
    this.firestore.pageReads.push({
      collectionPath: this.collectionPath,
      cursorPath: this.cursorPath,
    });

    const documents = this.firestore.documents
      .filter((document) => {
        if (!document.path.startsWith(`${this.collectionPath}/`)) return false;
        if (
          document.path.split("/").length !==
          this.collectionPath.split("/").length + 1
        ) {
          return false;
        }
        return !this.cursorPath || document.path > this.cursorPath;
      })
      .sort((first, second) => first.path.localeCompare(second.path))
      .slice(0, this.pageSize);

    return {
      docs: documents.map((document) => ({
        id: document.id,
        ref: { path: document.path },
        data: () => document.data,
      })),
    };
  }
}

test("paginates ordered documents and recursively reads every fake subcollection", async () => {
  const firestore = new FakeFirestore(
    [
      "users",
      "users/u1/clients",
      "users/u1/sales",
      "users/u1/sales/s1/payments",
      "users/u1/sales/deleted-sale/payments",
    ],
    [
      { path: "users/u1", id: "u1", data: { label: "fake user" } },
      { path: "users/u2", id: "u2", data: { label: "fake user two" } },
      { path: "users/u1/clients/c1", id: "c1", data: { label: "fake client" } },
      { path: "users/u1/sales/s1", id: "s1", data: { total: 100 } },
      {
        path: "users/u1/sales/s1/payments/p1",
        id: "p1",
        data: { value: 100 },
      },
      {
        path: "users/u1/sales/deleted-sale/payments/old-payment",
        id: "old-payment",
        data: { value: 25 },
      },
    ]
  );
  const reader = createFirestoreReader(firestore, "__name__");
  const chunks = await Array.fromAsync(
    createBackupJson(reader, {
      projectId: "fixture-only",
      pageSize: 1,
    })
  );
  const backup = JSON.parse(chunks.join(""));

  assert.equal(backup.manifest.documentCount, 6);
  assert.equal(backup.manifest.collectionCounts["users"], 2);
  assert.equal(backup.manifest.collectionCounts["users/u1/sales/s1/payments"], 1);
  assert.ok(backup.documents.some(({ path }) => path.endsWith("/payments/p1")));
  assert.ok(
    backup.documents.some(
      ({ path }) => path === "users/u1/sales/deleted-sale/payments/old-payment"
    )
  );
  assert.ok(
    firestore.pageReads.some(
      ({ collectionPath, cursorPath }) =>
        collectionPath === "users" && cursorPath === "users/u1"
    )
  );
});

test("creates one encrypted end-to-end backup from fake Firestore data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rc-backup-e2e-"));
  const outputPath = join(directory, "fixture.json.enc");
  const passphrase = "fictional-e2e-backup-passphrase";
  const firestore = new FakeFirestore(
    [
      "users",
      "users/u1/clients",
      "users/u1/clients/c1/payments",
      "users/u1/products",
      "users/u1/sales",
      "users/u1/sales/s1/payments",
      "users/u1/sales/deleted-sale/payments",
      "users/u1/expenses",
    ],
    [
      { path: "users/u1", id: "u1", data: { label: "fake account" } },
      {
        path: "users/u1/clients/c1",
        id: "c1",
        data: { name: "fake client" },
      },
      {
        path: "users/u1/clients/c1/payments/p1",
        id: "p1",
        data: { value: 18.5 },
      },
      {
        path: "users/u1/products/pr1",
        id: "pr1",
        data: { name: "fake product", quantity: 3 },
      },
      {
        path: "users/u1/sales/s1",
        id: "s1",
        data: { clientId: "c1", total: 18.5 },
      },
      {
        path: "users/u1/sales/s1/payments/p2",
        id: "p2",
        data: { value: 18.5 },
      },
      {
        path: "users/u1/sales/deleted-sale/payments/p-old",
        id: "p-old",
        data: { value: 1 },
      },
      {
        path: "users/u1/expenses/e1",
        id: "e1",
        data: { description: "fake expense", value: 4 },
      },
    ]
  );
  let manifest;

  try {
    const chunks = createBackupJson(
      createFirestoreReader(firestore, "__name__"),
      {
        projectId: "fixture-only",
        onManifest: (value) => {
          manifest = value;
        },
      }
    );
    const result = await encryptJsonToFile(chunks, {
      outputPath,
      repoRoot: resolve("."),
      passphrase,
    });
    const encrypted = await readFile(outputPath);
    const backup = JSON.parse(decryptBackupBuffer(encrypted, passphrase).toString());
    const paths = new Set(backup.documents.map(({ path }) => path));

    assert.equal(backup.manifest.documentCount, 8);
    assert.equal(manifest.documentCount, 8);
    assert.ok(paths.has("users/u1/clients/c1/payments/p1"));
    assert.ok(paths.has("users/u1/sales/s1/payments/p2"));
    assert.ok(paths.has("users/u1/sales/deleted-sale/payments/p-old"));
    assert.ok(paths.has("users/u1/products/pr1"));
    assert.ok(paths.has("users/u1/expenses/e1"));
    assert.equal(encrypted.includes(Buffer.from("fake client")), false);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});