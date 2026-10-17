export function createFirestoreReader(firestore, documentIdField) {
  const cursors = new Map();

  return {
    async listRootCollections() {
      const collections = await firestore.listCollections();
      return collections.map((collection) => collection.path);
    },

    async listChildCollections(documentPath) {
      const collections = await firestore.doc(documentPath).listCollections();
      return collections.map((collection) => collection.path);
    },

    async listCollectionDocumentPaths(collectionPath) {
      const documents = await firestore.collection(collectionPath).listDocuments();
      return documents.map((document) => document.path);
    },

    async readCollectionPage(collectionPath, cursorPath, pageSize) {
      let query = firestore
        .collection(collectionPath)
        .orderBy(documentIdField)
        .limit(pageSize);

      if (cursorPath) {
        const cursor = cursors.get(collectionPath);
        if (!cursor || cursor.ref.path !== cursorPath) {
          throw new Error(`Cursor de leitura inválido em ${collectionPath}.`);
        }
        query = query.startAfter(cursor);
      }

      const snapshot = await query.get();
      const documents = snapshot.docs;
      const lastDocument = documents.at(-1);

      if (lastDocument && documents.length === pageSize) {
        cursors.set(collectionPath, lastDocument);
      } else {
        cursors.delete(collectionPath);
      }

      return documents.map((document) => ({
        path: document.ref.path,
        id: document.id,
        data: document.data(),
      }));
    },
  };
}