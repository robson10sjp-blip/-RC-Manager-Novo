// Read-only Firestore access through the REST API using the user's own ID
// token, so Firestore security rules apply to every read. Only an allow-list of
// fields is kept; CPF/CNPJ, phones, addresses and free-text notes never leave
// this module.

export const COLLECTION_SPECS = {
  clients: { fields: ["name", "city", "totalDebt"] },
  products: {
    fields: [
      "name", "code", "category", "size", "quantity", "costPrice",
      "salePrice", "minimumStock", "targetStock", "quantitySold",
    ],
  },
  sales: {
    fields: [
      "clientId", "clientName", "total", "amountPaid", "pendingAmount",
      "paymentMethod", "balanceModel", "saleDate", "createdAt", "dueDate",
      "paymentDueDate", "collectionDate", "dataCobranca", "dataVencimento",
      "tripName", "tripCity", "tripNumber", "status",
    ],
    arrays: {
      items: ["productId", "quantity", "unitPrice", "subtotal", "costPrice", "size"],
    },
  },
  expenses: {
    fields: ["category", "value", "expenseDate", "createdAt", "tripNumber"],
  },
  suppliers: { fields: ["name"] },
  payables: {
    fields: [
      "supplierId", "supplierName", "description", "totalAmount",
      "paidAmount", "purchaseType", "tripNumber",
    ],
    arrays: {
      installments: ["amount", "paidAmount", "dueDate", "method", "identification"],
    },
  },
};

export class FirestoreAccessError extends Error {
  constructor(status) {
    super(`firestore_${status}`);
    this.name = "FirestoreAccessError";
    this.status = status;
  }
}

export function fromFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return new Date(value.timestampValue);
  if ("arrayValue" in value) {
    return (value.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ("mapValue" in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, nested]) => [
        key,
        fromFirestoreValue(nested),
      ])
    );
  }
  return null;
}

function pick(source, fields) {
  const result = {};
  for (const field of fields) {
    if (source[field] !== undefined) result[field] = source[field];
  }
  return result;
}

export function projectDocument(id, data, spec) {
  const result = { id, ...pick(data, spec.fields) };
  for (const [name, fields] of Object.entries(spec.arrays || {})) {
    if (Array.isArray(data[name])) {
      result[name] = data[name]
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => pick(entry, fields));
    }
  }
  return result;
}

export function createFirestoreReader({
  projectId,
  uid,
  idToken,
  fetchImpl = fetch,
  pageSize = 300,
  maxPages = 10,
}) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid || "")) {
    throw new Error("invalid_uid");
  }
  if (!/^[a-z0-9-]{1,64}$/.test(projectId || "")) {
    throw new Error("invalid_project");
  }

  async function readCollection(name) {
    const spec = COLLECTION_SPECS[name];
    if (!spec) throw new Error("collection_not_allowed");

    const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/${name}`;
    const documents = [];
    let pageToken = "";

    for (let page = 0; page < maxPages; page += 1) {
      const query = new URLSearchParams({ pageSize: String(pageSize) });
      if (pageToken) query.set("pageToken", pageToken);
      const response = await fetchImpl(`${base}?${query}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!response.ok) throw new FirestoreAccessError(response.status);

      const body = await response.json();
      for (const document of body.documents || []) {
        const data = Object.fromEntries(
          Object.entries(document.fields || {}).map(([key, value]) => [
            key,
            fromFirestoreValue(value),
          ])
        );
        const id = String(document.name || "").split("/").pop();
        documents.push(projectDocument(id, data, spec));
      }
      pageToken = body.nextPageToken || "";
      if (!pageToken) break;
    }

    return documents;
  }

  async function readAll() {
    const names = Object.keys(COLLECTION_SPECS);
    const results = await Promise.all(names.map(readCollection));
    return Object.fromEntries(names.map((name, index) => [name, results[index]]));
  }

  return { readCollection, readAll };
}
