import {
  calculateTripFinancialSummary,
  calculateConsolidatedReceivables,
  organizeSalesByTrip2026,
  selectSalesForTrip,
  summarizeTrips,
} from "./sales.js";
import {
  filterPayablesByTrip,
  getPayableBalance,
  summarizePayables,
} from "./payables.js";
import { toDate } from "../utils/dates.js";
import { buildCollectionsReport } from "./secretaryCollections.js";
import { getSalePendingAmount } from "./financeReceivables.js";

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isBetween(value, start, end) {
  const date = toDate(value);
  return date && date >= start && date < end;
}

function currency(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function nameForSale(sale, clientsById) {
  return (
    sale.clientName ||
    clientsById.get(sale.clientId)?.name ||
    "Cliente não informado"
  );
}

function saleDueDate(sale) {
  return toDate(
    sale.dueDate ||
      sale.paymentDueDate ||
      sale.collectionDate ||
      sale.dataCobranca
  );
}

const tripPeriods = {
  1: "período sem definição cadastrada",
  2: "período sem definição cadastrada",
  3: "01/07 a 30/09/2026",
  4: "01/10 a 31/12/2026",
};

function detectTripNumber(query) {
  if (/\b(viagem|periodo)\b/.test(query)) {
    if (/\b(julho|agosto|setembro)\b/.test(query)) return 3;
    if (/\b(outubro|novembro|dezembro)\b/.test(query)) return 4;
  }

  const match = query.match(
    /\b(?:primeira|primeiro|1(?:a|ª|o)?|segunda|segundo|2(?:a|ª|o)?|terceira|terceiro|3(?:a|ª|o)?|quarta|quarto|4(?:a|ª|o)?)\s*(?:viagem)?\b/
  );
  if (!match) return null;
  if (/^(?:primeira|primeiro|1)/.test(match[0])) return 1;
  if (/^(?:segunda|segundo|2)/.test(match[0])) return 2;
  if (/^(?:terceira|terceiro|3)/.test(match[0])) return 3;
  return 4;
}

function isAllTripsQuery(query) {
  if (detectTripNumber(query)) return false;
  return /\b(todas?\s+as?\s+viagens|todas?\s+viagens|todas?\s+as?\s+compras|total geral|geral de vendas|em todas|no total|total|geral|tudo|somado|somando)\b/.test(
    query
  );
}

function isDatedReceiptQuery(query) {
  return /\b(hoje|ontem|neste mes|esse mes|este mes|no mes|do mes|mensal)\b/.test(query);
}

function tripDescription(tripNumber) {
  if (tripNumber === 3 || tripNumber === 4) {
    return `${tripNumber}ª viagem (${tripPeriods[tripNumber]}, classificação provisória)`;
  }
  return `${tripNumber}ª viagem (${tripPeriods[tripNumber]}, vínculo registrado)`;
}

function expenseCategoryLabel(category) {
  const labels = {
    combustivel: "combustível",
    alimentacao: "alimentação",
    hotel: "hospedagem",
    manutencao: "manutenção",
    transporte: "transporte",
    mercadoria: "compra de mercadoria",
    outros: "outras categorias",
  };
  return labels[category] || "despesa";
}

function expensesTotalByCategory(snapshot, selectedCategory) {
  return (snapshot.allExpenses || [])
    .filter(
      (expense) =>
        !selectedCategory ||
        String(expense.category || "outros") === selectedCategory
    )
    .reduce((total, expense) => total + Number(expense.value || 0), 0);
}

function queryDateRange(query, now) {
  const monthNames = {
    janeiro: 0,
    fevereiro: 1,
    marco: 2,
    abril: 3,
    maio: 4,
    junho: 5,
    julho: 6,
    agosto: 7,
    setembro: 8,
    outubro: 9,
    novembro: 10,
    dezembro: 11,
  };
  const monthMatch = query.match(
    /\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/
  );
  if (monthMatch) {
    const year = Number(query.match(/\b20\d{2}\b/)?.[0] || now.getFullYear());
    const month = monthNames[monthMatch[1]];
    return {
      start: new Date(year, month, 1),
      end: new Date(year, month + 1, 1),
      label: `${monthMatch[1]} de ${year}`,
    };
  }

  const rangeMatch = query.match(
    /\bentre\s+(\d{1,2})[-/](\d{1,2})(?:[-/](\d{4}))?\s+(?:e|a)\s+(\d{1,2})[-/](\d{1,2})(?:[-/](\d{4}))?\b/
  );
  if (rangeMatch) {
    const year = Number(rangeMatch[3] || rangeMatch[6] || now.getFullYear());
    const start = new Date(year, Number(rangeMatch[2]) - 1, Number(rangeMatch[1]));
    const end = new Date(
      Number(rangeMatch[6] || year),
      Number(rangeMatch[5]) - 1,
      Number(rangeMatch[4]) + 1
    );
    if (start < end) {
      return {
        start,
        end,
        label: `${start.toLocaleDateString("pt-BR")} a ${new Date(end.getTime() - 1).toLocaleDateString("pt-BR")}`,
      };
    }
  }

  const nextDays = query.match(/\bproximos?\s+(\d{1,3})\s+dias?\b/);
  if (nextDays) {
    const start = startOfDay(now);
    const end = new Date(start);
    end.setDate(end.getDate() + Number(nextDays[1]) + 1);
    return { start, end, label: `próximos ${nextDays[1]} dias` };
  }
  if (/\bhoje\b/.test(query)) {
    const start = startOfDay(now);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end, label: "hoje" };
  }
  return null;
}

export function createSecretarySnapshot(
  {
    clients = [],
    sales = [],
    products = [],
    expenses = [],
    payments = [],
    legacyPayments = [],
    suppliers = [],
    payables = [],
  },
  now = new Date()
) {
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const monthStart = startOfMonth(now);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextWeek = new Date(tomorrow);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const enrichedPayables = payables.map((payable) => ({
    ...payable,
    supplierName:
      payable.supplierName ||
      suppliersById.get(payable.supplierId)?.name ||
      "Fornecedor não informado",
    balance: getPayableBalance(payable),
  }));
  const payableSummary = summarizePayables(enrichedPayables, now);
  const salePayments = new Map();

  for (const payment of payments) {
    const current = salePayments.get(payment.saleId) || [];
    current.push(payment);
    salePayments.set(payment.saleId, current);
  }

  const initialReceipts = sales.map((sale) => {
    const recordedPayments = salePayments
      .get(sale.id)
      ?.reduce((sum, payment) => sum + Number(payment.value || 0), 0) || 0;

    return {
      date: toDate(sale.saleDate) || toDate(sale.createdAt),
      value: Math.max(Number(sale.amountPaid || 0) - recordedPayments, 0),
    };
  });

  const datedReceipts = [
    ...payments.map((payment) => ({
      date: toDate(payment.createdAt),
      value: Number(payment.value || 0),
    })),
    ...legacyPayments.map((payment) => ({
      date: toDate(payment.createdAt),
      value: Number(payment.value || 0),
    })),
    ...initialReceipts,
  ];

  const receivedToday = datedReceipts.reduce(
    (sum, receipt) =>
      sum + (isBetween(receipt.date, today, tomorrow) ? receipt.value : 0),
    0
  );
  const receivedThisMonth = datedReceipts.reduce(
    (sum, receipt) =>
      sum +
      (isBetween(receipt.date, monthStart, nextMonthStart)
        ? receipt.value
        : 0),
    0
  );
  const receivedAllTime = datedReceipts.reduce(
    (sum, receipt) => sum + receipt.value,
    0
  );
  const salesToday = sales
    .filter((sale) =>
      isBetween(
        toDate(sale.saleDate) || toDate(sale.createdAt),
        today,
        tomorrow
      )
    )
    .map((sale) => ({
      ...sale,
      clientName: nameForSale(sale, clientsById),
    }));
  const salesThisMonth = sales
    .filter((sale) =>
      isBetween(
        toDate(sale.saleDate) || toDate(sale.createdAt),
        monthStart,
        nextMonthStart
      )
    )
    .map((sale) => ({
      ...sale,
      clientName: nameForSale(sale, clientsById),
    }));
  const expensesToday = expenses.filter((expense) =>
    isBetween(
      expense.expenseDate || expense.createdAt,
      today,
      tomorrow
    )
  );
  const expensesThisMonth = expenses.filter((expense) =>
    isBetween(
      expense.expenseDate || expense.createdAt,
      monthStart,
      nextMonthStart
    )
  );

  const pendingSales = sales
    .filter((sale) => Number(sale.pendingAmount || 0) > 0)
    .map((sale) => ({
      id: sale.id,
      clientName: nameForSale(sale, clientsById),
      value: Number(sale.pendingAmount || 0),
      dueDate: saleDueDate(sale),
      tripName: sale.tripName || "",
      tripCity: sale.tripCity || "",
    }))
    .sort((first, second) => {
      const firstDate = first.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const secondDate = second.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return firstDate - secondDate || second.value - first.value;
    });

  const overdueSales = pendingSales.filter(
    (sale) => sale.dueDate && sale.dueDate < today
  );
  const dueSoonSales = pendingSales.filter(
    (sale) =>
      sale.dueDate &&
      sale.dueDate >= today &&
      sale.dueDate < nextWeek
  );
  const receivables = calculateConsolidatedReceivables(clients, sales);
  const legacyDebtors = receivables.clients
    .filter((client) => client.legacyBalance > 0)
    .map((client) => ({
      clientName: client.clientName,
      value: client.legacyBalance,
      dueDate: null,
      legacy: true,
    }));
  const allTripDebtors = [
    ...receivables.clients
      .filter((client) => client.totalPending > 0)
      .map((client) => ({
        clientName: client.clientName,
        value: client.totalPending,
      })),
    ...receivables.unassignedSales.map((sale) => ({
      clientName: nameForSale(sale, clientsById),
      value: Number(sale.pendingAmount || 0),
    })),
  ];
  const lowStockProducts = products
    .filter((product) => Number(product.quantity || 0) <= 3)
    .sort(
      (first, second) =>
        Number(first.quantity || 0) - Number(second.quantity || 0)
    );
  const tripsThisMonth = summarizeTrips(salesThisMonth);
  const totalPending = receivables.totalPending;
  const tripOrganization = organizeSalesByTrip2026(sales);
  const tripFinancials = Object.fromEntries(
    [1, 2, 3, 4].map((tripNumber) => [
      tripNumber,
      calculateTripFinancialSummary(
        selectSalesForTrip(tripOrganization, String(tripNumber)),
        expenses.filter(
          (expense) => Number(expense.tripNumber) === tripNumber
        ),
        products,
        filterPayablesByTrip(enrichedPayables, String(tripNumber))
      ),
    ])
  );
  const tripPending = Object.fromEntries(
    [3, 4].map((tripNumber) => {
      const tripSales = selectSalesForTrip(tripOrganization, String(tripNumber));
      const open = tripSales.filter((sale) => getSalePendingAmount(sale) > 0);
      return [
        tripNumber,
        {
          amount:
            Math.round(
              open.reduce((sum, sale) => sum + getSalePendingAmount(sale), 0) * 100
            ) / 100,
          salesCount: open.length,
        },
      ];
    })
  );
  const tripDebtors = Object.fromEntries(
    [1, 2, 3, 4].map((tripNumber) => {
      const tripSales = selectSalesForTrip(
        tripOrganization,
        String(tripNumber)
      );
      const tripReceivables = calculateConsolidatedReceivables(
        clients.map((client) => ({ ...client, totalDebt: 0 })),
        tripSales
      );
      const debtors = tripReceivables.clients
        .filter((client) => client.totalPending > 0)
        .map((client) => ({
          clientName: client.clientName,
          value: client.totalPending,
        }));

      debtors.push(
        ...tripReceivables.unassignedSales.map((sale) => ({
          clientName: nameForSale(sale, clientsById),
          value: Number(sale.pendingAmount || 0),
        }))
      );

      return [tripNumber, debtors.sort((first, second) => second.value - first.value)];
    })
  );
  const tripExpenseCategories = Object.fromEntries(
    [1, 2, 3, 4].map((tripNumber) => [
      tripNumber,
      expenses
        .filter((expense) => Number(expense.tripNumber) === tripNumber)
        .reduce((categories, expense) => {
          const category = String(expense.category || "outros");
          categories[category] =
            (categories[category] || 0) + Number(expense.value || 0);
          return categories;
        }, {}),
    ])
  );
  const allTripFinancials = calculateTripFinancialSummary(
    sales,
    expenses,
    products,
    enrichedPayables
  );

  return {
    today,
    salesToday,
    salesTodayTotal: salesToday.reduce(
      (sum, sale) => sum + Number(sale.total || 0),
      0
    ),
    salesThisMonth,
    salesThisMonthTotal: salesThisMonth.reduce(
      (sum, sale) => sum + Number(sale.total || 0),
      0
    ),
    receivedToday,
    receivedThisMonth,
    receivedAllTime,
    expensesToday,
    expensesTodayTotal: expensesToday.reduce(
      (sum, expense) => sum + Number(expense.value || 0),
      0
    ),
    expensesThisMonth,
    expensesThisMonthTotal: expensesThisMonth.reduce(
      (sum, expense) => sum + Number(expense.value || 0),
      0
    ),
    allExpenses: expenses,
    payables: enrichedPayables,
    payableSummary,
    pendingSales,
    overdueSales,
    dueSoonSales,
    legacyDebtors,
    allTripDebtors,
    totalPending,
    lowStockProducts,
    tripsThisMonth,
    tripFinancials,
    tripPending,
    tripDebtors,
    tripExpenseCategories,
    allTripFinancials,
    clientsCount: clients.length,
    productsCount: products.length,
    collectionClients: clients,
    collectionSales: sales,
  };
}

function asksCollectionsList(query) {
  return (
    /\b(quem|quais|lista|liste|listar|mostre|mostra|relacao|nomes)\b/.test(
      query
    ) &&
    /\b(cobrar|cobranca|cobrancas|atraso|atrasados|atrasadas|vencid[oa]s?|vencem|vencimento|vencimentos)\b/.test(
      query
    )
  );
}

function collectionsAnswer(query, snapshot, tripContext) {
  if (!asksCollectionsList(query)) return null;

  const explicitTrip = detectTripNumber(query);
  const scope = explicitTrip
    ? explicitTrip
    : isAllTripsQuery(query)
      ? "all"
      : typeof tripContext === "number"
        ? tripContext
        : ["1", "2", "3", "4"].includes(String(tripContext))
          ? Number(tripContext)
          : tripContext === "all"
            ? "all"
            : null;
  const focusToday = /\bhoje\b/.test(query);
  const effectiveScope = scope ?? (focusToday ? "all" : null);
  if (!effectiveScope) return null;

  const report = buildCollectionsReport({
    clients: snapshot.collectionClients || [],
    sales: snapshot.collectionSales || [],
    today: snapshot.today,
    trip: effectiveScope,
  });
  const tripLabel =
    effectiveScope === "all"
      ? "Todas as viagens (total geral)"
      : tripDescription(effectiveScope);
  const provisional =
    effectiveScope === "all" || effectiveScope === 3 || effectiveScope === 4;
  const collections = { report, focusToday, tripLabel, provisional };

  const line = (group, name) =>
    `${name}: ${group.count} cobrança(s), ${currency(group.total)}`;
  const answer = [
    `Cobranças — ${tripLabel}${provisional ? ". A classificação por viagem ainda é provisória." : "."}`,
    line(report.overdue, "Vencidas"),
    line(report.today, "Vencem hoje"),
    focusToday
      ? `Próximas a vencer (apenas para planejamento, não são para hoje): ${report.upcoming.count} cobrança(s), ${currency(report.upcoming.total)}`
      : line(report.upcoming, "Próximas a vencer"),
    line(report.noDueDate, "Vencimento não informado"),
  ].join("\n");

  return { answer, collections };
}

function formatSales(sales) {
  if (!sales.length) return "Nenhuma venda encontrada nesse período.";

  return sales
    .slice(0, 5)
    .map((sale) => `• ${sale.clientName}: ${currency(sale.total)}`)
    .join("\n");
}

export function answerSecretaryQueryWithContext(
  question,
  snapshot,
  intelligence,
  previousTripContext = null
) {
  const query = String(question || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  const explicitTrip = detectTripNumber(query);
  const explicitAll = !explicitTrip && isAllTripsQuery(query);
  const tripContext = explicitTrip || (explicitAll ? "all" : previousTripContext);
  const collectionsResponse = collectionsAnswer(query, snapshot, tripContext);

  if (collectionsResponse) {
    return { ...collectionsResponse, tripContext };
  }

  return {
    answer: answerSecretaryQuery(
      question,
      snapshot,
      intelligence,
      tripContext
    ),
    tripContext,
  };
}

export function answerSecretaryQuery(
  question,
  snapshot,
  intelligence,
  selectedTripContext = null
) {
  const query = String(question || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");

  const asksReceivableTotal =
    /\b(a receber|para receber|falta receber|resta receber|a entrar|para entrar|em aberto|pendente|pendentes|devem|deve|devedores|saldo devedor|saldos devedores|cobrar|cobranca|cobrancas|divida|dividas|em atraso|atrasados)\b/.test(
      query
    ) ||
    /\bquanto (?:tenho|temos|falta|resta)\b.*\breceber\b/.test(query) ||
    (/\bclientes?\b/.test(query) && /\breceber\b/.test(query));
  const asksReceivedAmount =
    /\b(recebi|recebemos|recebido|recebidos|recebida|recebidas|recebimento|recebimentos|caiu|cairam|entrou|entraram|entrada|entradas)\b/.test(
      query
    );
  const asksForTotal =
    /\b(total|geral|tudo|todos|todas|no fim|somado|somando|inteiro)\b/.test(
      query
    );

  const explicitTrip = detectTripNumber(query);
  const allTrips =
    !explicitTrip &&
    (isAllTripsQuery(query) || selectedTripContext === "all");
  const tripNumber =
    explicitTrip ||
    (typeof selectedTripContext === "number"
      ? selectedTripContext
      : typeof selectedTripContext === "string" &&
          ["1", "2", "3", "4"].includes(selectedTripContext)
        ? Number(selectedTripContext)
        : null);
  const asksExpenseTotal =
    /\b(gastei|gastamos|gasto|gastos|despesa|despesas|custou|custo)\b/.test(
      query
    );
  const asksFuel = /\b(combustivel|gasolina|diesel|etanol|alcool)\b/.test(
    query
  );
  const asksFood = /\b(alimentacao|comida|refeicao)\b/.test(query);
  const asksLodging = /\b(hospedagem|hotel|pousada)\b/.test(query);
  const asksMaintenance = /\b(manutencao|conserto|oficina)\b/.test(query);
  const asksExpenseCategory =
    asksFuel || asksFood || asksLodging || asksMaintenance;
  const expenseCategory = asksFuel
    ? "combustivel"
    : asksFood
      ? "alimentacao"
      : asksLodging
        ? "hotel"
        : asksMaintenance
          ? "manutencao"
          : null;
  const asksTripProfit =
    /\b(lucro|lucrei|lucramos|lucrativo|lucrativa)\b/.test(query);
  const asksTripSales =
    /\b(vendi|vendas|faturamento|faturei|vendido)\b/.test(query) &&
    !/\b(produto\s+mais\s+vendido|mais\s+vendido\s+produto)\b/.test(query);
  const asksTripReceived =
    /\b(recebi|recebemos|recebido|recebimentos?|entrada|entradas)\b/.test(
      query
    );
  const asksTripPending =
    /\b(falta receber|resta receber|a receber|para receber|devo receber|em aberto|pendente|pendentes|devendo|devem|deve|devo|cobrar|cobranca|cobrancas|devedores|devedor|divida|dividas)\b/.test(
      query
    );
  const asksDebtorList =
    /\b(quem|quais|lista|liste|listar|mostre|mostra|relacao)\b/.test(
      query
    ) && asksTripPending;
  const asksTripComparison =
    /\b(qual|quais)\b/.test(query) &&
    /\b(viagem|viagens)\b/.test(query) &&
    /\b(maior|melhor|mais)\b/.test(query) &&
    /\b(lucro|lucrativa|faturamento|vendeu|vendas)\b/.test(query);
  const asksPayableBalance =
    !asksReceivableTotal &&
    /\b(quanto devo|devemos|contas? a pagar|a pagar|obrigacoes? com fornecedores|devo aos fornecedores|saldo devedor com fornecedores|total devido aos fornecedores)\b/.test(
      query
    );
  const asksWhoToPay =
    (/\b(a quem|para quem)\b/.test(query) ||
      (/\b(quem|quais)\b/.test(query) &&
        /\b(fornecedor|fornecedores)\b/.test(query))) &&
    /\b(devo|pagar|fornecedor|fornecedores|conta|contas|divida|dividas)\b/.test(
      query
    );
  const asksPayableOverdue =
    /\b(parcelas?|contas?|pagamentos?|cheques?)\b/.test(query) &&
    /\b(vencid[oa]s?|atrasad[oa]s?|em atraso)\b/.test(query);
  const asksChecksDue =
    /\b(cheque|cheques)\b/.test(query) &&
    /\b(venc|vencimento|vencem|vence|quando)\b/.test(query);
  const asksPayables = asksPayableBalance || asksWhoToPay || asksPayableOverdue || asksChecksDue;

  if (asksPayables) {
    const filteredPayables = filterPayablesByTrip(
      snapshot.payables || [],
      allTrips || selectedTripContext === "all"
        ? "all"
        : tripNumber || "all"
    );
    const summary = summarizePayables(filteredPayables, snapshot.today);
    const tripLabel = tripNumber
      ? tripDescription(tripNumber)
      : "Obrigações gerais da empresa (todas as viagens e contas sem viagem)";
    const dateRange = queryDateRange(query, snapshot.today);
    const periodMessage = tripNumber
      ? ` Visão: ${tripLabel}.`
      : " Esta visão inclui todas as viagens e contas ainda sem viagem vinculada.";

    if (asksChecksDue) {
      const checks = filteredPayables.flatMap((payable) =>
        (payable.installments || [])
          .filter((item) => {
            const remaining = Math.max(
              Number(item.amount || 0) - Number(item.paidAmount || 0),
              0
            );
            const dueDate = toDate(item.dueDate);
            return (
              String(item.method || "").toLocaleLowerCase("pt-BR") ===
                "cheque" &&
              remaining > 0 &&
              dueDate &&
              (!dateRange ||
                (dueDate >= dateRange.start && dueDate < dateRange.end))
            );
          })
          .map((item) => ({
            supplierName: payable.supplierName,
            description: payable.description,
            identification: item.identification || "sem identificação",
            dueDate: toDate(item.dueDate),
            amount: Math.max(
              Number(item.amount || 0) - Number(item.paidAmount || 0),
              0
            ),
          }))
      );
      checks.sort((first, second) => first.dueDate - second.dueDate);
      const periodLabel = dateRange?.label || "todos os períodos cadastrados";
      return checks.length
        ? `Cheques a vencer em ${periodLabel}:${periodMessage}\n${checks
            .slice(0, 12)
            .map(
              (item) =>
                `• ${item.dueDate.toLocaleDateString("pt-BR")} — ${item.supplierName}, cheque ${item.identification}: ${currency(item.amount)} (${item.description})`
            )
            .join("\n")}`
        : `Não encontrei cheques em aberto para ${periodLabel}.${periodMessage}`;
    }

    if (asksPayableOverdue) {
      return summary.overdueItems.length
        ? `Parcelas e títulos vencidos: ${currency(summary.overdueTotal)} em ${summary.overdueItems.length} item(ns).${periodMessage}\n${summary.overdueItems
            .slice(0, 12)
            .map(
              (item) =>
                `• ${item.dueDate.toLocaleDateString("pt-BR")} — ${item.supplierName}, ${item.method === "cheque" ? "cheque" : "parcela"} ${item.identification ? `#${item.identification}` : ""}: ${currency(item.amount)} (${item.description})`
            )
            .join("\n")}`
        : `Não há parcelas vencidas em aberto nesta visão.${periodMessage}`;
    }

    if (asksWhoToPay) {
      const grouped = new Map();
      for (const payable of filteredPayables) {
        const balance = getPayableBalance(payable);
        if (balance <= 0) continue;
        const key = payable.supplierId || payable.supplierName;
        const current = grouped.get(key) || {
          name: payable.supplierName,
          balance: 0,
          accounts: 0,
        };
        current.balance += balance;
        current.accounts += 1;
        grouped.set(key, current);
      }
      const suppliersOwed = [...grouped.values()].sort(
        (first, second) => second.balance - first.balance
      );
      return suppliersOwed.length
        ? `Você deve ${currency(summary.totalToPay)} a ${suppliersOwed.length} fornecedor(es):${periodMessage}\n${suppliersOwed
            .slice(0, 12)
            .map(
              (supplier) =>
                `• ${supplier.name}: ${currency(supplier.balance)} em ${supplier.accounts} conta(s)`
            )
            .join("\n")}`
        : `Não há saldo em aberto com fornecedores nesta visão.${periodMessage}`;
    }

    return `Saldo total a pagar aos fornecedores: ${currency(summary.totalToPay)}. Já pago neste histórico: ${currency(summary.totalPaid)}.${periodMessage}`;
  }

  if (asksTripComparison && (asksTripProfit || asksTripSales)) {
    const tripsWithSales = Object.entries(snapshot.tripFinancials || {})
      .map(([number, financials]) => ({
        number: Number(number),
        ...financials,
      }))
      .filter((trip) => trip.salesCount > 0);
    const trips = tripsWithSales
      .filter((trip) => !asksTripProfit || trip.hasCompleteCostData)
      .sort((first, second) =>
        asksTripProfit
          ? second.estimatedProfit - first.estimatedProfit
          : second.sold - first.sold
      );
    const bestTrip = trips[0];
    const tripsMissingCost = tripsWithSales.filter(
      (trip) => !trip.hasCompleteCostData
    );
    if (asksTripProfit && tripsMissingCost.length) {
      if (!bestTrip) {
        return `Ainda não é possível comparar o lucro: faltam custos cadastrados das mercadorias nas viagens ${tripsMissingCost.map((trip) => `${trip.number}ª`).join(", ")}.`;
      }
      return `Não é possível identificar com segurança a viagem mais lucrativa: faltam custos cadastrados das mercadorias nas viagens ${tripsMissingCost.map((trip) => `${trip.number}ª`).join(", ")}. Entre as viagens com custo completo, a ${tripDescription(bestTrip.number)} tem o maior lucro estimado, de ${currency(bestTrip.estimatedProfit)}.`;
    }
    if (!bestTrip && asksTripProfit) {
      return "Ainda não há dados completos de custo das mercadorias para comparar o lucro das viagens.";
    }
    return bestTrip
      ? `A viagem com maior ${asksTripProfit ? "lucro estimado" : "faturamento"} é a ${tripDescription(bestTrip.number)}, com ${currency(asksTripProfit ? bestTrip.estimatedProfit : bestTrip.sold)}. Resultado provisório baseado nas despesas já vinculadas.`
      : "Ainda não há vendas classificadas por viagem para comparar.";
  }

  const hasTripFinancialQuestion =
    asksExpenseTotal ||
    asksExpenseCategory ||
    asksTripProfit ||
    asksTripSales ||
    asksTripReceived ||
    asksTripPending;
  const hasDatedReceiptRequest = asksTripReceived && isDatedReceiptQuery(query);
  const hasDatedSalesRequest =
    asksTripSales &&
    /\b(hoje|ontem|neste mes|esse mes|este mes|no mes|do mes|mensal)\b/.test(
      query
    );
  const hasDatedProfitRequest =
    asksTripProfit &&
    /\b(hoje|ontem|neste mes|esse mes|este mes|no mes|do mes|mensal)\b/.test(
      query
    );
  const hasDatedFinancialRequest =
    hasDatedReceiptRequest || hasDatedSalesRequest || hasDatedProfitRequest;

  if (
    hasTripFinancialQuestion &&
    !allTrips &&
    !tripNumber &&
    !hasDatedFinancialRequest
  ) {
    return "Quer consultar uma viagem específica ou o total geral de todas as viagens? Você pode dizer, por exemplo, “3ª viagem”, “4ª viagem” ou “todas as viagens”.";
  }

  if (
    (tripNumber || allTrips) &&
    hasTripFinancialQuestion &&
    !hasDatedFinancialRequest
  ) {
    const financials = allTrips
      ? snapshot.allTripFinancials
      : snapshot.tripFinancials?.[tripNumber];
    if (!financials) {
      return `Ainda não há dados financeiros disponíveis para a ${tripNumber}ª viagem.`;
    }

    const tripLabel = allTrips
      ? "Todas as viagens (total geral)"
      : tripDescription(tripNumber);
    const isProvisional = allTrips || tripNumber === 3 || tripNumber === 4;
    const resultLabel = isProvisional
      ? "Lucro estimado provisório"
      : "Lucro estimado";
    const answers = [];
    if (asksTripSales || asksTripProfit) {
      answers.push(
        `${tripLabel}: ${financials.salesCount} venda(s), total vendido de ${currency(financials.sold)} e total recebido vinculado às compras de ${currency(financials.received)}.`
      );
    }
    if (asksTripReceived && !asksTripSales && !asksTripProfit) {
      answers.push(
        `${tripLabel}: recebimentos vinculados às vendas dessa viagem, independentemente da data em que foram pagos: ${currency(financials.received)}.`
      );
    }
    if (asksTripPending && !asksDebtorList && !asksTripProfit) {
      const pending = allTrips
        ? snapshot.totalPending
        : financials.pending;
      answers.push(
        allTrips
          ? `Total consolidado a receber, sem somar saldos históricos duplicados: ${currency(pending)}.`
          : `${tripLabel}: falta receber ${currency(pending)}.`
      );
    }
    if (asksExpenseTotal || asksExpenseCategory || asksTripProfit) {
      const categoryTotals =
        allTrips
          ? expensesTotalByCategory(snapshot, expenseCategory)
          : expenseCategory
            ? Number(
                snapshot.tripExpenseCategories?.[tripNumber]?.[
                  expenseCategory
                ] || 0
              )
            : financials.expenses;
      answers.push(
        asksExpenseCategory
          ? `${tripLabel}: despesas de ${expenseCategoryLabel(expenseCategory)} ${allTrips ? "em todos os registros" : "vinculadas à viagem"}: ${currency(categoryTotals)}.`
          : `${tripLabel}: total de despesas vinculadas ${allTrips ? "às viagens" : "à viagem"}: ${currency(categoryTotals)}.`
      );
    }
    if (asksDebtorList) {
      const debtors = allTrips
        ? snapshot.allTripDebtors || []
        : snapshot.tripDebtors?.[tripNumber] || [];
      answers.push(
        debtors.length
          ? `Clientes com valores pendentes em ${tripLabel}: ${debtors
              .slice(0, 10)
              .map((debtor) => `${debtor.clientName} (${currency(debtor.value)})`)
              .join("; ")}.`
          : `Não encontrei clientes com valores pendentes em ${tripLabel}.`
      );
    }
    if (asksTripProfit) {
      answers.push(
        financials.hasCompleteCostData
          ? `${resultLabel} (vendas menos custo estimado das mercadorias, despesas vinculadas e compras operacionais de fornecedores): ${currency(financials.estimatedProfit)}. Fluxo de caixa simplificado (recebimentos menos despesas e pagamentos a fornecedores): ${currency(financials.cashFlow)}.`
          : `Não consigo calcular o lucro estimado de ${tripLabel}: faltam custos cadastrados das mercadorias. O fluxo de caixa simplificado é ${currency(financials.cashFlow)}.`
      );
    }
    const periodLine = allTrips
      ? "Período: todos os registros disponíveis. Despesas sem viagem também entram apenas neste consolidado geral."
      : `Período utilizado: ${tripDescription(tripNumber)}.`;
    answers.push(`${periodLine}${isProvisional ? " A classificação das vendas pode mudar após confirmação." : ""}`);
    return answers.join("\n");
  }

  if (
    /\b(quem|quais|lista|liste|listar|mostre|mostra|relacao|nomes)\b/.test(
      query
    ) &&
    /\b(cobrar|cobranca|cobrancas|devem|deve|devedor|devedores|pendente|pendentes|atraso|atrasados|saldo devedor)\b/.test(
      query
    )
  ) {
    if (!tripNumber && !allTrips && !isDatedReceiptQuery(query)) {
      return "Quer consultar uma viagem específica ou o total geral de todas as viagens? Os saldos são separados por compra e viagem.";
    }
    const debtors = [...snapshot.pendingSales, ...snapshot.legacyDebtors];
    if (!debtors.length) {
      return "Não encontrei cobranças pendentes nos dados disponíveis.";
    }

    return [
      `Há ${debtors.length} cobrança(s) pendente(s), de um total de ${currency(snapshot.totalPending)}:`,
      ...debtors.slice(0, 8).map((sale) => {
        const due = sale.dueDate
          ? ` — ${sale.dueDate < snapshot.today ? "vencida em" : "vence em"} ${sale.dueDate.toLocaleDateString("pt-BR")}`
          : " — saldo legado sem vencimento informado";
        return `• ${sale.clientName}: ${currency(sale.value)}${due}`;
      }),
    ].join("\n");
  }

  if (asksReceivableTotal) {
    return `Total consolidado a receber, sem somar saldos históricos duplicados: ${currency(snapshot.totalPending)}.`;
  }

  if (asksReceivedAmount) {
    if (asksForTotal) {
      return `Total de recebimentos registrados: ${currency(snapshot.receivedAllTime)}. Hoje: ${currency(snapshot.receivedToday)}; neste mês: ${currency(snapshot.receivedThisMonth)}.`;
    }

    return [
      `Recebimentos registrados hoje: ${currency(snapshot.receivedToday)}.`,
      `Neste mês: ${currency(snapshot.receivedThisMonth)}.`,
      "Os valores consideram os recebimentos vinculados às compras e o histórico de saldo legado.",
    ].join("\n");
  }

  if (
    intelligence &&
    (query.includes("faturamento") ||
      query.includes("lucro") ||
      query.includes("ticket medio") ||
      query.includes("previsao") ||
      query.includes("meta mensal"))
  ) {
    const answers = [];
    if (query.includes("faturamento")) {
      answers.push(
        `Faturamento do mês: ${currency(intelligence.monthSales)}.`
      );
    }
    if (query.includes("lucro")) {
      answers.push(
        `Lucro bruto estimado: ${currency(intelligence.grossProfit)}.`,
        `Lucro líquido estimado: ${currency(intelligence.netProfit)}.`
      );
    }
    if (query.includes("ticket medio")) {
      answers.push(
        `Ticket médio do mês: ${currency(intelligence.averageTicket)}.`
      );
    }
    if (query.includes("previsao")) {
      answers.push(
        `Previsão de faturamento do mês: ${currency(intelligence.forecastMonth)}.`
      );
    }
    if (query.includes("meta mensal")) {
      answers.push(
        `Progresso da meta mensal: ${intelligence.goalProgress.toFixed(1)}%.`,
        `Faltam ${currency(intelligence.remainingGoal)} para a meta.`
      );
    }
    return answers.join("\n");
  }

  if (intelligence && query.includes("recompra")) {
    if (!intelligence.likelyToBuyAgain.length) {
      return "Ainda não há dados suficientes para identificar clientes com chance de recompra.";
    }
    return [
      "Clientes com chance de recompra:",
      ...intelligence.likelyToBuyAgain
        .slice(0, 5)
        .map(
          (client) =>
            `• ${client.name} — chance ${client.score}/11, última compra há ${client.daysSinceLastPurchase} dia(s)`
        ),
    ].join("\n");
  }

  if (intelligence && query.includes("melhor cliente")) {
    const client = intelligence.bestClients[0];
    return client
      ? `Melhor cliente por faturamento acumulado: ${client.name}, com ${currency(client.totalBought)} em compras.`
      : "Ainda não há vendas suficientes para identificar o melhor cliente.";
  }

  if (intelligence && query.includes("produto parado")) {
    return intelligence.slowProducts.length
      ? [
          "Produtos com estoque e sem vendas registradas:",
          ...intelligence.slowProducts
            .slice(0, 8)
            .map(
              (product) =>
                `• ${product.name}: ${product.stock} unidade(s), ${currency(product.stockValue)} em custo de estoque`
            ),
        ].join("\n")
      : "Não encontrei produtos com estoque sem vendas registradas.";
  }

  if (intelligence && query.includes("melhor cidade")) {
    const city = intelligence.bestCities[0];
    return city
      ? `Cidade com maior faturamento: ${city.city}, com ${currency(city.totalSales)} em ${city.salesCount} venda(s).`
      : "Ainda não há dados de vendas por cidade.";
  }

  if (
    intelligence &&
    (query.includes("produto mais vendido") ||
      query.includes("produto campeao"))
  ) {
    const product = intelligence.bestProducts[0];
    return product
      ? `Produto mais vendido: ${product.name}, com ${product.quantitySold} unidade(s) vendida(s).`
      : "Ainda não há vendas de produtos para montar esse ranking.";
  }

  if (intelligence && (query.includes("repor") || query.includes("reposicao"))) {
    return intelligence.lowStockProducts.length
      ? [
          "Sugestões de reposição calculadas pelo histórico:",
          ...intelligence.lowStockProducts
            .slice(0, 8)
            .map(
              (product) =>
                `• ${product.name}: estoque ${product.stock}; sugestão de reposição ${product.suggestedRestock}`
            ),
        ].join("\n")
      : "Não há produtos abaixo do limite de estoque definido para reposição.";
  }

  if (intelligence && query.includes("alerta")) {
    return intelligence.alerts.length
      ? [
          "Alertas calculados para a gestão:",
          ...intelligence.alerts.map(
            (alert) => `• ${alert.title}: ${alert.description}`
          ),
        ].join("\n")
      : "Não há alertas calculados neste momento.";
  }

  if (/\b(venda|vendas|vendi|vendeu|vendemos|venderam|vendido|vendida)\b/.test(query)) {
    return [
      `Hoje: ${snapshot.salesToday.length} venda(s), total de ${currency(snapshot.salesTodayTotal)}.`,
      `Neste mês: ${snapshot.salesThisMonth.length} venda(s), total de ${currency(snapshot.salesThisMonthTotal)}.`,
      formatSales(snapshot.salesToday),
    ].join("\n");
  }

  if (query.includes("resumo") || query.includes("hoje")) {
    const priorities = [];
    if (snapshot.overdueSales.length) {
      priorities.push(
        `${snapshot.overdueSales.length} cobrança(s) vencida(s) (${currency(
          snapshot.overdueSales.reduce((sum, sale) => sum + sale.value, 0)
        )})`
      );
    }
    if (snapshot.dueSoonSales.length) {
      priorities.push(`${snapshot.dueSoonSales.length} vencimento(s) nos próximos 7 dias`);
    }
    if (snapshot.lowStockProducts.length) {
      priorities.push(`${snapshot.lowStockProducts.length} produto(s) com estoque baixo`);
    }

    return [
      `Resumo de hoje: ${snapshot.salesToday.length} venda(s), totalizando ${currency(snapshot.salesTodayTotal)}.`,
      `Recebimentos registrados hoje: ${currency(snapshot.receivedToday)}.`,
      `Despesas de hoje: ${currency(snapshot.expensesTodayTotal)}.`,
      priorities.length
        ? `Prioridades: ${priorities.join("; ")}.`
        : "Nenhum vencimento próximo ou alerta de estoque baixo encontrado.",
    ].join("\n");
  }

  if (query.includes("estoque") || query.includes("produto")) {
    if (!snapshot.lowStockProducts.length) {
      return `Não há produtos com 3 unidades ou menos. ${snapshot.productsCount} produto(s) consultados.`;
    }

    return [
      `${snapshot.lowStockProducts.length} produto(s) estão com estoque baixo (3 unidades ou menos):`,
      ...snapshot.lowStockProducts.slice(0, 8).map(
        (product) =>
          `• ${product.name || "Produto"}: ${Number(product.quantity || 0)} unidade(s)`
      ),
    ].join("\n");
  }

  if (query.includes("despesa") || query.includes("gasto")) {
    return [
      `Despesas de hoje: ${currency(snapshot.expensesTodayTotal)} (${snapshot.expensesToday.length} registro(s)).`,
      `Despesas neste mês: ${currency(snapshot.expensesThisMonthTotal)} (${snapshot.expensesThisMonth.length} registro(s)).`,
    ].join("\n");
  }

  if (query.includes("viagem") || query.includes("cidade")) {
    if (!snapshot.tripsThisMonth.length) {
      return "Não encontrei vendas associadas a viagens neste mês.";
    }

    return [
      `Viagens com vendas neste mês (${snapshot.tripsThisMonth.length}):`,
      ...snapshot.tripsThisMonth.slice(0, 8).map(
        (trip) =>
          `• ${trip.name}${trip.city ? ` — ${trip.city}` : ""}: ${currency(trip.sold)} em vendas, ${currency(trip.pending)} pendente`
      ),
    ].join("\n");
  }

  if (query.includes("cliente")) {
    return `Há ${snapshot.clientsCount} cliente(s) cadastrados. Para consultar cobranças, pergunte “Quem devo cobrar?”.`;
  }

  return "Ainda não tenho uma IA conversacional conectada. Posso consultar seus dados localmente: tente “Resumo de hoje”, “Quem devo cobrar?”, “Quanto recebi?”, “Minhas vendas”, “Estoque”, “Despesas” ou “Viagens”.";
}
