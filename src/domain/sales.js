import { toDate } from "../utils/dates.js";

function money(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function escapeReceiptText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character];
  });
}

export function calculateSaleAmounts(items = [], amountPaid = 0) {
  const total = money(
    items.reduce(
      (sum, item) =>
        sum +
        Number(item.quantity || 0) *
          Number(item.price ?? item.unitPrice ?? 0),
      0
    )
  );
  const received = money(amountPaid);
  const pending = money(Math.max(total - received, 0));

  return {
    total,
    amountPaid: received,
    pendingAmount: pending,
    status:
      total <= 0 || received <= 0
        ? "pending"
        : pending <= 0
          ? "paid"
          : "partial",
  };
}

export function applyPaymentToSale(sale, paymentValue) {
  const payment = money(paymentValue);
  const pending = money(sale.pendingAmount);

  if (!Number.isFinite(payment) || payment <= 0) {
    throw new Error("O valor recebido deve ser maior que zero.");
  }

  if (payment > pending) {
    throw new Error("O valor recebido não pode ser maior que o saldo.");
  }

  const updatedPaid = money(Number(sale.amountPaid || 0) + payment);
  const updatedPending = money(pending - payment);

  return {
    amountPaid: updatedPaid,
    pendingAmount: updatedPending,
    status: updatedPending <= 0 ? "paid" : "partial",
  };
}

export function reusePaymentOperation(
  previousOperation,
  saleId,
  paymentValue,
  createId
) {
  const amount = money(paymentValue);

  if (
    previousOperation?.saleId === saleId &&
    money(previousOperation.amount) === amount
  ) {
    return previousOperation;
  }

  const id = createId();
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Não foi possível identificar o recebimento.");
  }

  return { saleId, amount, id };
}

export function adjustLegacyClientDebt(
  sale,
  clientDebt,
  previousSaleBalance,
  nextSaleBalance
) {
  if (sale.balanceModel === "per-sale") return null;

  const currentDebt = money(clientDebt);
  const previousBalance = money(previousSaleBalance);

  if (currentDebt < previousBalance) {
    throw new Error(
      "O saldo antigo do cliente é menor que o saldo desta compra. Concilie os valores antes de continuar."
    );
  }

  return money(
    currentDebt - previousBalance + money(nextSaleBalance)
  );
}

export function isSaleOverdue(dueDate, pendingAmount, today = new Date()) {
  const due = toDate(dueDate);

  if (!due || money(pendingAmount) <= 0) return false;

  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const currentDay = new Date(today);
  currentDay.setHours(0, 0, 0, 0);

  return dueDay < currentDay;
}

export function updateStockAfterSale(currentStock, quantity) {
  const stock = Number(currentStock || 0);
  const sold = Number(quantity || 0);

  if (!Number.isFinite(sold) || sold <= 0 || sold > stock) {
    throw new Error("Quantidade inválida ou estoque insuficiente.");
  }

  return stock - sold;
}

export function updateStockAfterSaleEdit(currentStock, oldQuantity, newQuantity) {
  const updatedStock =
    Number(currentStock || 0) +
    Number(oldQuantity || 0) -
    Number(newQuantity || 0);

  if (!Number.isFinite(updatedStock) || updatedStock < 0) {
    throw new Error("Estoque insuficiente para editar a compra.");
  }

  return updatedStock;
}

export function summarizeTrips(sales = []) {
  const trips = new Map();

  for (const sale of sales) {
    const name = String(sale.tripName || "").trim();
    const city = String(sale.tripCity || "").trim();

    if (!name && !city) continue;

    const key = `${name.toLocaleLowerCase("pt-BR")}|${city.toLocaleLowerCase("pt-BR")}`;
    const current = trips.get(key) || {
      name: name || "Viagem sem nome",
      city,
      salesCount: 0,
      sold: 0,
      received: 0,
      pending: 0,
    };

    current.salesCount += 1;
    current.sold = money(current.sold + Number(sale.total || 0));
    current.received = money(
      current.received + Number(sale.amountPaid || 0)
    );
    current.pending = money(
      current.pending + Number(sale.pendingAmount || 0)
    );
    trips.set(key, current);
  }

  return Array.from(trips.values()).sort(
    (first, second) => second.sold - first.sold
  );
}

export function organizeSalesByTrip2026(sales = []) {
  const thirdStart = new Date(2026, 6, 1);
  const fourthStart = new Date(2026, 9, 1);
  const fifthStart = new Date(2027, 0, 1);
  const candidates = { 3: [], 4: [] };
  const review = [];
  const amount = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value || 0);
    return Number.isFinite(number)
      ? Math.round(number * 100) / 100
      : null;
  };

  for (const sale of sales) {
    const saleDate = toDate(sale.saleDate);
    const createdAt = saleDate ? null : toDate(sale.createdAt);
    const originalSaleDate = saleDate || createdAt;
    let tripNumber = null;
    let reason;

    if (!originalSaleDate) {
      reason = sale.saleDate
        ? "A data original da venda é inválida."
        : "A venda não tem data original nem data de criação confiável.";
    } else {
      const saleDay = new Date(
        originalSaleDate.getFullYear(),
        originalSaleDate.getMonth(),
        originalSaleDate.getDate()
      );

      if (saleDay < thirdStart) {
        reason = "A venda é anterior a julho de 2026; a 1ª e 2ª viagens ainda precisam de definição.";
      } else if (saleDay >= fifthStart) {
        reason = "A data está fora dos períodos definidos para a 3ª e 4ª viagens.";
      } else {
        tripNumber = saleDay >= fourthStart ? 4 : 3;
      }
    }

    const total = amount(sale.total);
    const received = amount(sale.amountPaid);
    const pending = amount(sale.pendingAmount);
    const entry = {
      ...sale,
      originalSaleDate,
      dateSource: saleDate ? "saleDate" : createdAt ? "createdAt" : null,
      total,
      amountPaid: received,
      pendingAmount: pending,
      tripNumber: reason ? null : tripNumber,
      suggestedTripNumber: tripNumber,
      reviewReason: reason || "",
    };

    if (reason) {
      review.push(entry);
    } else if (tripNumber) {
      candidates[tripNumber].push(entry);
    }
  }

  const summarize = (items) => ({
    count: items.length,
    sold: Math.round(
      items.reduce((sum, sale) => sum + (sale.total || 0), 0) * 100
    ) / 100,
    received: Math.round(
      items.reduce((sum, sale) => sum + (sale.amountPaid || 0), 0) * 100
    ) / 100,
    pending: Math.round(
      items.reduce((sum, sale) => sum + (sale.pendingAmount || 0), 0) * 100
    ) / 100,
    incompleteValues: items.filter(
      (sale) =>
        sale.total === null ||
        sale.amountPaid === null ||
        sale.pendingAmount === null
    ).length,
  });

  return {
    thirdTrip: { sales: candidates[3], ...summarize(candidates[3]) },
    fourthTrip: { sales: candidates[4], ...summarize(candidates[4]) },
    review: { sales: review, ...summarize(review) },
    allSales: sales,
  };
}

export function selectSalesForTrip(organization, trip = "all") {
  if (trip === "unassigned") return [];
  if (trip === "third" || String(trip) === "3") {
    return organization?.thirdTrip?.sales || [];
  }
  if (trip === "fourth" || String(trip) === "4") {
    return organization?.fourthTrip?.sales || [];
  }
  if (trip === "review") return organization?.review?.sales || [];
  if (["1", "2"].includes(String(trip))) {
    return (organization?.allSales || []).filter(
      (sale) => String(sale.tripNumber || "") === String(trip)
    );
  }
  return organization?.allSales || [];
}

export function calculateTripFinancialSummary(
  sales = [],
  expenses = [],
  products = [],
  payables = []
) {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const summary = {
    sold: 0,
    received: 0,
    pending: 0,
    expenses: 0,
    supplierPayments: 0,
    supplierOperationalPurchases: 0,
    costOfGoodsSold: 0,
    estimatedProfit: 0,
    cashFlow: 0,
    salesCount: sales.length,
    hasCompleteCostData: true,
  };

  for (const sale of sales) {
    summary.sold += Number(sale.total || 0);
    summary.received += Number(sale.amountPaid || 0);
    summary.pending += Number(sale.pendingAmount || 0);

    if (!(sale.items || []).length && Number(sale.total || 0) > 0) {
      summary.hasCompleteCostData = false;
    }

    for (const item of sale.items || []) {
      const product = productsById.get(item.productId);
      const itemCost = item.costPrice ?? product?.costPrice;
      const quantity = Number(item.quantity || 0);

      if (itemCost === null || itemCost === undefined || itemCost === "") {
        if (quantity > 0) summary.hasCompleteCostData = false;
        continue;
      }

      const cost = Number(itemCost);
      if (!Number.isFinite(cost) || cost < 0) {
        summary.hasCompleteCostData = false;
        continue;
      }

      summary.costOfGoodsSold += quantity * cost;
    }
  }

  summary.expenses = expenses.reduce(
    (total, expense) => total + Number(expense.value || 0),
    0
  );
  summary.supplierPayments = payables.reduce(
    (total, payable) => total + Number(payable.paidAmount || 0),
    0
  );
  summary.supplierOperationalPurchases = payables.reduce(
    (total, payable) =>
      total +
      (payable.purchaseType === "operational"
        ? Number(payable.totalAmount || 0)
        : 0),
    0
  );
  summary.estimatedProfit = summary.hasCompleteCostData
    ? money(
        summary.sold -
          summary.costOfGoodsSold -
          summary.expenses -
          summary.supplierOperationalPurchases
      )
    : null;
  summary.cashFlow = money(
    summary.received - summary.expenses - summary.supplierPayments
  );

  return {
    ...summary,
    sold: money(summary.sold),
    received: money(summary.received),
    pending: money(summary.pending),
    expenses: money(summary.expenses),
    supplierPayments: money(summary.supplierPayments),
    supplierOperationalPurchases: money(summary.supplierOperationalPurchases),
    costOfGoodsSold: money(summary.costOfGoodsSold),
  };
}

export function calculateConsolidatedReceivables(clients = [], sales = []) {
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const salesByClient = new Map();
  const unassignedSales = [];

  for (const sale of sales) {
    const amount = Number(sale.pendingAmount || 0);
    const pending = money(
      Number.isFinite(amount) ? Math.max(amount, 0) : 0
    );
    if (pending <= 0) continue;

    if (sale.clientId && clientsById.has(sale.clientId)) {
      const current = salesByClient.get(sale.clientId) || [];
      current.push({ ...sale, pendingAmount: pending });
      salesByClient.set(sale.clientId, current);
    } else {
      unassignedSales.push({ ...sale, pendingAmount: pending });
    }
  }

  const clientBalances = clients.map((client) => {
    const linkedSales = salesByClient.get(client.id) || [];
    const hasLegacySale = sales.some(
      (sale) =>
        sale.clientId === client.id &&
        sale.balanceModel !== "per-sale"
    );
    const amount = Number(client.totalDebt || 0);
    const legacyBalance =
      !hasLegacySale && Number.isFinite(amount)
        ? money(Math.max(amount, 0))
        : 0;
    const salesPending = money(
      linkedSales.reduce((sum, sale) => sum + sale.pendingAmount, 0)
    );

    return {
      clientId: client.id,
      clientName:
        client.name ||
        linkedSales.find((sale) => sale.clientName)?.clientName ||
        "Cliente não informado",
      legacyBalance,
      salesPending,
      totalPending: money(legacyBalance + salesPending),
      sales: linkedSales,
    };
  });

  const unassignedPending = money(
    unassignedSales.reduce(
      (sum, sale) => sum + sale.pendingAmount,
      0
    )
  );

  return {
    clients: clientBalances,
    unassignedSales,
    unassignedPending,
    totalPending: money(
      clientBalances.reduce((sum, client) => sum + client.totalPending, 0) +
        unassignedPending
    ),
  };
}

export function analyzeLegacyBalances(clients = [], sales = []) {
  const salesByClient = new Map();

  for (const sale of sales) {
    if (!sale.clientId) continue;

    salesByClient.set(
      sale.clientId,
      money(
        (salesByClient.get(sale.clientId) || 0) +
          Number(sale.pendingAmount || 0)
      )
    );
  }

  return clients.map((client) => {
    const legacyBalance = money(client.totalDebt);
    const purchaseBalance = money(salesByClient.get(client.id) || 0);

    return {
      clientId: client.id,
      clientName: client.name || "Cliente não informado",
      legacyBalance,
      purchaseBalance,
      difference: money(legacyBalance - purchaseBalance),
      needsReview: legacyBalance > 0 && purchaseBalance > 0,
      hasLegacyOnly: legacyBalance > 0 && purchaseBalance === 0,
      hasPurchasesOnly: legacyBalance === 0 && purchaseBalance > 0,
    };
  });
}

// "Calça feminina — Tam. 36". Não duplica o tamanho se o nome já o contém.
export function formatItemLabel(item = {}) {
  const name = String(item.name || item.productName || "").trim();
  const size = String(item.size || "").trim();
  if (!size) return name;
  if (/\s[—-]\s*Tam\.\s/i.test(name)) return name;
  return `${name} — Tam. ${size}`;
}

export function prepareSaleReceipt(sale, now = new Date()) {
  const saleDate =
    toDate(sale.saleDate) ||
    toDate(sale.createdAt) ||
    now;

  let dueDate =
    sale.dueDate ||
    sale.paymentDueDate ||
    sale.collectionDate ||
    sale.dataCobranca ||
    null;

  if (
    !dueDate &&
    sale.balanceModel !== "per-sale" &&
    sale.paymentMethod === "prazo"
  ) {
    dueDate = new Date(saleDate);
    dueDate.setDate(dueDate.getDate() + 90);
  }

  const savedReceiptNumber = String(sale.receiptNumber || "").trim();
  const saleId = String(sale.id || "").trim();

  return {
    ...sale,
    items: Array.isArray(sale.items)
      ? sale.items.map((item) => ({ ...item, name: formatItemLabel(item) }))
      : sale.items,
    saleDate,
    dueDate,
    receiptNumber:
      savedReceiptNumber && !/^0+$/.test(savedReceiptNumber)
        ? savedReceiptNumber
        : saleId
          ? saleId.slice(-6)
          : String(now.getTime()).slice(-6),
  };
}

function sumQuantitiesByProduct(items = []) {
  const totals = new Map();
  for (const item of items) {
    if (!item?.productId) continue;
    const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
    totals.set(item.productId, (totals.get(item.productId) || 0) + quantity);
  }
  return totals;
}

// Compara os itens gravados com os editados. Cada produto (ID único, que já
// representa tamanho/numeração) recebe a diferença: positiva = baixa adicional,
// negativa = devolução. Itens repetidos são agrupados e diferença zero é omitida.
export function calculateStockDeltas(oldItems = [], newItems = []) {
  const oldTotals = sumQuantitiesByProduct(oldItems);
  const newTotals = sumQuantitiesByProduct(newItems);
  const deltas = new Map();

  for (const productId of new Set([...oldTotals.keys(), ...newTotals.keys()])) {
    const difference =
      (newTotals.get(productId) || 0) - (oldTotals.get(productId) || 0);
    if (difference !== 0) deltas.set(productId, difference);
  }

  return deltas;
}

// Aplica a diferença ao estoque atual. Só exige estoque para a quantidade
// adicional; nunca permite resultado negativo.
export function applyStockDelta(currentStock, delta, productName = "produto") {
  const stock = Number(currentStock) || 0;
  const updated = stock - delta;

  if (delta > 0 && delta > stock) {
    throw new Error(
      `Estoque insuficiente para ${productName}. Quantidade adicional: ${delta}. Disponível: ${stock}.`
    );
  }

  if (updated < 0) {
    throw new Error(`Estoque inválido para ${productName}.`);
  }

  return updated;
}

// Maior quantidade que a linha pode ter ao editar: estoque atual + o que a venda já reservou.
export function getMaxEditableQuantity(currentStock, originalQuantity = 0) {
  return (
    Math.max(0, Number(currentStock) || 0) +
    Math.max(0, Math.floor(Number(originalQuantity) || 0))
  );
}
