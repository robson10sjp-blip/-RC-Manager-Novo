import assert from "node:assert/strict";
import test from "node:test";
import { createBackupJson } from "../src/backup-core.mjs";

class FakeTimestamp {
  constructor(seconds, nanoseconds) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  toDate() {
    return new Date(this.seconds * 1000);
  }
}

class FakeDocumentReference {
  constructor(path) {
    this.path = path;
    this.id = path.split("/").at(-1);
    this.parent = {};
  }

  get() {
    return Promise.resolve();
  }
}

class Bytes {
  constructor(value) {
    this.value = Uint8Array.from(value);
  }

  toUint8Array() {
    return this.value;
  }
}

class GeoPoint {
  constructor(latitude, longitude) {
    this.latitude = latitude;
    this.longitude = longitude;
  }
}

class FixtureReader {
  constructor(documents, collections) {
    this.documents = documents;
    this.collections = collections;
  }

  async listRootCollections() {
    return this.collections.filter((path) => !path.includes("/"));
  }

  async listChildCollections(documentPath) {
    const prefix = `${documentPath}/`;
    const parentSegments = documentPath.split("/").length;

    return this.collections.filter((path) => {
      if (!path.startsWith(prefix)) return false;
      return path.split("/").length === parentSegments + 1;
    });
  }

  async listCollectionDocumentPaths(collectionPath) {
    const paths = this.documents
      .filter(
        (document) =>
          document.path.startsWith(`${collectionPath}/`) &&
          document.path.split("/").length === collectionPath.split("/").length + 1
      )
      .map((document) => document.path);

    for (const childCollection of this.collections) {
      if (!childCollection.startsWith(`${collectionPath}/`)) continue;
      const firstSegment = childCollection.slice(`${collectionPath}/`.length).split("/")[0];
      const documentPath = `${collectionPath}/${firstSegment}`;
      if (documentPath.split("/").length === collectionPath.split("/").length + 1) {
        paths.push(documentPath);
      }
    }

    return [...new Set(paths)];
  }

  async readCollectionPage(collectionPath, cursorPath, pageSize) {
    return this.documents
      .filter((document) => {
        if (!document.path.startsWith(`${collectionPath}/`)) return false;
        if (document.path.split("/").length !== collectionPath.split("/").length + 1) {
          return false;
        }
        return !cursorPath || document.path > cursorPath;
      })
      .sort((first, second) => first.path.localeCompare(second.path))
      .slice(0, pageSize);
  }
}

test("exports every nested fixture document, typed fields, and a count manifest", async () => {
  const documents = [
    {
      path: "users/u1",
      id: "u1",
      data: {
        active: true,
        createdAt: new FakeTimestamp(1760000000, 123456789),
        payload: new Bytes([0, 1, 255]),
        largeInteger: 9007199254740993n,
        location: new GeoPoint(-23.5, -46.6),
      },
    },
    {
      path: "users/u1/clients/c1",
      id: "c1",
      data: {
        name: "Cliente fictício",
        account: new FakeDocumentReference("users/u1/clients/c1"),
      },
    },
    {
      path: "users/u1/clients/c1/payments/p1",
      id: "p1",
      data: { value: 12.34, occurredAt: new FakeTimestamp(1760000010, 42) },
    },
    {
      path: "users/u1/products/prod1",
      id: "prod1",
      data: { name: "Produto fictício", quantity: 5 },
    },
    {
      path: "users/u1/sales/s1",
      id: "s1",
      data: { clientId: "c1", total: 12.34, items: ["prod1"] },
    },
    {
      path: "users/u1/sales/s1/payments/p2",
      id: "p2",
      data: { value: 12.34, saleId: "s1" },
    },
    {
      path: "users/u1/sales/orphan/payments/p3",
      id: "p3",
      data: { value: 6.5, saleId: "orphan" },
    },
    {
      path: "users/u1/expenses/e1",
      id: "e1",
      data: { description: "Despesa fictícia", value: 2.5 },
    },
  ];
  const collections = [
    "users",
    "users/u1/clients",
    "users/u1/clients/c1/payments",
    "users/u1/products",
    "users/u1/sales",
    "users/u1/sales/s1/payments",
    "users/u1/sales/orphan/payments",
    "users/u1/expenses",
  ];
  const chunks = await Array.fromAsync(
    createBackupJson(new FixtureReader(documents, collections), {
      projectId: "fixture-only",
      exportedAt: new Date("2026-01-02T03:04:05.000Z"),
      pageSize: 2,
    })
  );
  const backup = JSON.parse(chunks.join(""));
  const exportedPaths = backup.documents.map((document) => document.path);

  assert.equal(backup.format, "rc-firestore-backup");
  assert.equal(backup.projectId, "fixture-only");
  assert.equal(backup.manifest.documentCount, documents.length);
  assert.deepEqual(new Set(exportedPaths), new Set(documents.map(({ path }) => path)));
  assert.equal(backup.manifest.collectionCounts["users/u1/sales/s1/payments"], 1);
  assert.equal(backup.manifest.collectionCounts["users/u1/sales/orphan/payments"], 1);
  assert.equal(backup.manifest.collectionCounts["users/u1/clients/c1/payments"], 1);

  const user = backup.documents.find(({ path }) => path === "users/u1");
  assert.deepEqual(user.data.fields.createdAt, {
    type: "timestamp",
    seconds: 1760000000,
    nanoseconds: 123456789,
  });
  assert.deepEqual(user.data.fields.payload, {
    type: "bytes",
    base64: "AAH/",
  });
  assert.deepEqual(user.data.fields.largeInteger, {
    type: "integer",
    value: "9007199254740993",
  });
  assert.deepEqual(user.data.fields.location, {
    type: "geoPoint",
    latitude: -23.5,
    longitude: -46.6,
  });

  const client = backup.documents.find(({ path }) => path.endsWith("/clients/c1"));
  assert.deepEqual(client.data.fields.account, {
    type: "reference",
    path: "users/u1/clients/c1",
  });
});

test("aborts rather than accepting an invalid document path", async () => {
  const reader = new FixtureReader(
    [{ path: "users/u1", id: "different", data: {} }],
    ["users"]
  );

  await assert.rejects(
    async () => Array.fromAsync(createBackupJson(reader, { projectId: "fixture-only" })),
    /Caminho de documento inválido/
  );
});