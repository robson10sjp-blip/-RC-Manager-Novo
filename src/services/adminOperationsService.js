import {
  validateExpense,
  validateNewProduct,
  validateStockEntry,
} from "../domain/adminOperations.js";

export class AdminOperationError extends Error {
  constructor(message, code = "invalid") {
    super(message);
    this.name = "AdminOperationError";
    this.code = code;
  }
}

const ALLOWED_OPERATIONS = ["expense", "product", "stockEntry"];
const processed = new Set();

export function resetProcessedOperations() {
  processed.clear();
}

// Ponto único de decisão de permissão. Hoje: usuário autenticado gravando na própria conta.
export function canWriteOperation(user, type) {
  return Boolean(user?.uid) && ALLOWED_OPERATIONS.includes(type);
}

function summarize(draft, values) {
  if (draft.type === "expense") return "despesa";
  if (draft.type === "product") return `produto ${values.code}`;
  return `entrada de ${values.quantity} unidade(s) em ${values.name}`;
}

/**
 * Executa uma operação já confirmada por clique.
 * - Sem usuário autenticado ou sem permissão: recusa.
 * - Prévia somente leitura: apenas simula e NÃO chama nenhuma função de gravação.
 * - Usa sempre users/{uid}/... com o uid do login, nas coleções que as páginas já usam.
 */
export async function executeAdminOperation(draft, { user, readOnly, products = [], api }) {
  if (!draft || draft.status !== "confirming") {
    throw new AdminOperationError("A operação precisa ser confirmada pelo botão antes de ser executada.", "not_confirmed");
  }
  if (!user?.uid) throw new AdminOperationError("Você precisa entrar novamente no sistema.", "unauthenticated");
  if (!canWriteOperation(user, draft.type)) {
    throw new AdminOperationError("Você não tem permissão para esta operação.", "forbidden");
  }
  if (processed.has(draft.id)) {
    throw new AdminOperationError("Esta operação já foi processada.", "duplicate_submit");
  }

  let values;
  if (draft.type === "expense") {
    const validation = validateExpense(draft.fields);
    if (!validation.valid) throw new AdminOperationError(Object.values(validation.errors)[0]);
    values = validation.values;
  } else if (draft.type === "product") {
    const validation = validateNewProduct(draft.fields, products);
    if (validation.duplicate) {
      throw new AdminOperationError("Já existe um produto igual. Nada foi cadastrado.", "duplicate_product");
    }
    if (!validation.valid) throw new AdminOperationError(Object.values(validation.errors)[0]);
    values = validation.values;
  } else {
    const product = products.find((item) => item.id === draft.fields.productId);
    const validation = validateStockEntry(draft.fields, product);
    if (!validation.valid) throw new AdminOperationError(Object.values(validation.errors)[0]);
    values = validation.values;
  }

  processed.add(draft.id);

  if (readOnly) {
    return {
      ok: true,
      simulated: true,
      message: `Simulação concluída: ${summarize(draft, values)}. Nada foi gravado no Firebase (prévia somente leitura).`,
    };
  }

  if (!api) {
    processed.delete(draft.id);
    throw new AdminOperationError("Gravação indisponível neste ambiente.", "no_api");
  }

  const { db, collection, doc, serverTimestamp, addDoc, runTransaction } = api;
  try {
    if (draft.type === "expense") {
      const date = values.expenseDate;
      await addDoc(collection(db, "users", user.uid, "expenses"), {
        category: values.category,
        description: values.description,
        value: values.value,
        expenseDate: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12),
        tripNumber: values.tripNumber,
        tripId: values.tripId,
        tripName: values.tripName,
        tripYear: values.tripYear,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
    } else if (draft.type === "product") {
      await addDoc(collection(db, "users", user.uid, "products"), {
        code: values.code,
        name: values.name,
        category: values.category,
        size: values.size,
        color: values.color,
        costPrice: values.costPrice,
        salePrice: values.salePrice,
        quantity: values.quantity,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
    } else {
      const productReference = doc(db, "users", user.uid, "products", values.productId);
      const movementReference = doc(collection(db, "users", user.uid, "stockMovements"));
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(productReference);
        if (!snapshot.exists()) throw new AdminOperationError("Produto não encontrado.", "not_found");
        const saved = snapshot.data();
        const current = Math.max(Math.floor(Number(saved.quantity) || 0), 0);
        if (current !== values.previousQuantity) {
          throw new AdminOperationError(
            `O estoque mudou desde a prévia (agora ${current}). Refaça o comando para conferir.`,
            "stale"
          );
        }
        const newQuantity = current + values.quantity;
        transaction.update(productReference, { quantity: newQuantity, updatedAt: serverTimestamp() });
        transaction.set(movementReference, {
          productId: values.productId,
          productName: saved.name || "",
          productCode: saved.code || "",
          type: "entrada",
          quantity: values.quantity,
          previousQuantity: current,
          newQuantity,
          reason: "Entrada registrada pela Secretária RC",
          createdAt: serverTimestamp(),
        });
      });
    }
  } catch (error) {
    processed.delete(draft.id);
    if (error instanceof AdminOperationError) throw error;
    throw new AdminOperationError("Não foi possível gravar a operação. Nada foi concluído.", "write_failed");
  }

  return { ok: true, simulated: false, message: `Operação concluída: ${summarize(draft, values)} registrada com sucesso.` };
}
