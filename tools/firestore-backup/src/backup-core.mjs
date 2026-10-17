const FORMAT = "rc-firestore-backup";
const VERSION = 1;

function isTimestamp(value) {
  return (
    Number.isInteger(value.seconds) &&
    Number.isInteger(value.nanoseconds) &&
    typeof value.toDate === "function"
  );
}

function isDocumentReference(value) {
  return (
    typeof value.path === "string" &&
    typeof value.id === "string" &&
    typeof value.get === "function" &&
    value.parent != null
  );
}

function encodeValue(value) {
  if (value === null) return { type: "null" };
  if (typeof value === "string") return { type: "string", value };
  if (typeof value === "boolean") return { type: "boolean", value };
  if (typeof value === "bigint") {
    return { type: "integer", value: value.toString() };
  }

  if (typeof value === "number") {
    if (Number.isNaN(value)) return { type: "double", value: "NaN" };
    if (value === Infinity) return { type: "double", value: "Infinity" };
    if (value === -Infinity) return { type: "double", value: "-Infinity" };
    if (Object.is(value, -0)) return { type: "double", value: "-0" };
    return { type: Number.isInteger(value) ? "integer" : "double", value };
  }

  if (value instanceof Date) {
    const seconds = Math.floor(value.getTime() / 1000);
    return {
      type: "timestamp",
      seconds,
      nanoseconds: (value.getTime() - seconds * 1000) * 1_000_000,
    };
  }

  if (value && typeof value === "object") {
    if (isTimestamp(value)) {
      return {
        type: "timestamp",
        seconds: value.seconds,
        nanoseconds: value.nanoseconds,
      };
    }

    if (isDocumentReference(value)) {
      return { type: "reference", path: value.path };
    }

    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      return {
        type: "bytes",
        base64: Buffer.from(value).toString("base64"),
      };
    }

    if (
      value.constructor?.name === "Bytes" &&
      typeof value.toUint8Array === "function"
    ) {
      return {
        type: "bytes",
        base64: Buffer.from(value.toUint8Array()).toString("base64"),
      };
    }

    if (
      value.constructor?.name === "GeoPoint" &&
      Number.isFinite(value.latitude) &&
      Number.isFinite(value.longitude)
    ) {
      return {
        type: "geoPoint",
        latitude: value.latitude,
        longitude: value.longitude,
      };
    }

    if (Array.isArray(value)) {
      return { type: "array", values: value.map(encodeValue) };
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      return {
        type: "map",
        fields: Object.fromEntries(
          Object.entries(value).map(([key, fieldValue]) => [
            key,
            encodeValue(fieldValue),
          ])
        ),
      };
    }
  }

  throw new TypeError(`Tipo Firestore não suportado: ${typeof value}`);
}

function validateCollectionPath(path, parentDocumentPath = null) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.endsWith("/")) {
    throw new Error(`Caminho de coleção inválido: ${String(path)}`);
  }

  const segments = path.split("/");
  if (segments.length % 2 !== 1) {
    throw new Error(`Caminho de coleção inválido: ${path}`);
  }

  if (parentDocumentPath !== null) {
    const prefix = `${parentDocumentPath}/`;
    const childName = path.startsWith(prefix)
      ? path.slice(prefix.length)
      : "";

    if (!childName || childName.includes("/")) {
      throw new Error(`Subcoleção fora do documento pai: ${path}`);
    }
  }
}

function encodeDocument(document) {
  if (!document || typeof document.path !== "string" || !document.path) {
    throw new Error("Documento sem caminho completo.");
  }

  if (typeof document.id !== "string" || !document.id || document.id.includes("/")) {
    throw new Error(`ID de documento inválido em ${document.path}.`);
  }

  const segments = document.path.split("/");
  const collectionPath = segments.slice(0, -1).join("/");
  validateCollectionPath(collectionPath);

  if (segments.at(-1) !== document.id) {
    throw new Error(`ID não corresponde ao caminho do documento ${document.path}.`);
  }

  if (!document.data || typeof document.data !== "object" || Array.isArray(document.data)) {
    throw new Error(`Dados inválidos no documento ${document.path}.`);
  }

  return {
    path: document.path,
    id: document.id,
    data: encodeValue(document.data),
  };
}

export async function* createBackupJson(
  reader,
  {
    projectId,
    databaseId = "(default)",
    pageSize = 300,
    exportedAt = new Date(),
    onManifest,
  }
) {
  if (!projectId || typeof projectId !== "string") {
    throw new Error("projectId é obrigatório.");
  }

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("pageSize deve estar entre 1 e 1000.");
  }

  const collectionCounts = new Map();
  const seenDocuments = new Set();
  let documentCount = 0;

  yield `{"format":${JSON.stringify(FORMAT)},"version":${VERSION},`;
  yield `"projectId":${JSON.stringify(projectId)},`;
  yield `"databaseId":${JSON.stringify(databaseId)},`;
  yield `"exportedAt":${JSON.stringify(exportedAt.toISOString())},"documents":[`;

  let firstDocument = true;

  async function* walkCollection(collectionPath, parentDocumentPath = null) {
    validateCollectionPath(collectionPath, parentDocumentPath);

    if (collectionCounts.has(collectionPath)) {
      throw new Error(`Coleção percorrida mais de uma vez: ${collectionPath}`);
    }

    collectionCounts.set(collectionPath, 0);
    let cursorPath = null;

    while (true) {
      const page = await reader.readCollectionPage(
        collectionPath,
        cursorPath,
        pageSize
      );

      if (!Array.isArray(page) || page.length > pageSize) {
        throw new Error(`Página inválida para a coleção ${collectionPath}.`);
      }

      if (page.length === 0) break;

      for (const document of page) {
        if (seenDocuments.has(document.path)) {
          throw new Error(`Documento repetido durante a leitura: ${document.path}`);
        }

        if (!document.path.startsWith(`${collectionPath}/`)) {
          throw new Error(`Documento fora da coleção ${collectionPath}.`);
        }

        const documentSegments = document.path.split("/");
        if (
          documentSegments.length !== collectionPath.split("/").length + 1 ||
          documentSegments.at(-1) !== document.id
        ) {
          throw new Error(`Caminho de documento inválido: ${document.path}`);
        }

        seenDocuments.add(document.path);
        collectionCounts.set(
          collectionPath,
          collectionCounts.get(collectionPath) + 1
        );
        documentCount += 1;

        if (!firstDocument) yield ",";
        yield JSON.stringify(encodeDocument(document));
        firstDocument = false;

        const childCollections = await reader.listChildCollections(document.path);
        if (!Array.isArray(childCollections)) {
          throw new Error(`Subcoleções inválidas em ${document.path}.`);
        }

        for (const childPath of [...childCollections].sort()) {
          yield* walkCollection(childPath, document.path);
        }
      }

      const nextCursor = page.at(-1).path;
      if (nextCursor === cursorPath) {
        throw new Error(`Paginação sem avanço na coleção ${collectionPath}.`);
      }

      cursorPath = nextCursor;
      if (page.length < pageSize) break;
    }

    const referencedDocumentPaths = await reader.listCollectionDocumentPaths(
      collectionPath
    );
    if (!Array.isArray(referencedDocumentPaths)) {
      throw new Error(`Referências de documentos inválidas em ${collectionPath}.`);
    }

    const checkedPaths = new Set();
    for (const documentPath of referencedDocumentPaths) {
      if (
        typeof documentPath !== "string" ||
        !documentPath.startsWith(`${collectionPath}/`) ||
        documentPath.split("/").length !== collectionPath.split("/").length + 1 ||
        checkedPaths.has(documentPath)
      ) {
        throw new Error(`Referência de documento inválida em ${collectionPath}.`);
      }

      checkedPaths.add(documentPath);
      if (seenDocuments.has(documentPath)) continue;

      const childCollections = await reader.listChildCollections(documentPath);
      if (!Array.isArray(childCollections)) {
        throw new Error(`Subcoleções inválidas em ${documentPath}.`);
      }

      for (const childPath of [...childCollections].sort()) {
        yield* walkCollection(childPath, documentPath);
      }
    }
  }

  const rootCollections = await reader.listRootCollections();
  if (!Array.isArray(rootCollections)) {
    throw new Error("A enumeração das coleções raiz falhou.");
  }

  for (const collectionPath of [...rootCollections].sort()) {
    yield* walkCollection(collectionPath);
  }

  const manifest = {
    documentCount,
    collectionCounts: Object.fromEntries(
      [...collectionCounts.entries()].sort(([first], [second]) =>
        first.localeCompare(second)
      )
    ),
  };

  onManifest?.(manifest);
  yield `],"manifest":${JSON.stringify(manifest)}}`;
}