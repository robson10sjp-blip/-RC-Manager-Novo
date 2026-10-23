import assert from "node:assert/strict";
import test from "node:test";

import {
  answerSecretaryQuery,
  answerSecretaryQueryWithContext,
  createSecretarySnapshot,
} from "./secretary.js";

const today = new Date(2026, 9, 17, 12);

test("summarizes real sales, payments, expenses, due dates and stock for today", () => {
  const snapshot = createSecretarySnapshot(
    {
      clients: [
        { id: "client-1", name: "Ana" },
        { id: "client-2", name: "Bia", totalDebt: 50 },
      ],
      sales: [
        {
          id: "sale-today",
          clientId: "client-1",
          total: 120,
          amountPaid: 40,
          pendingAmount: 80,
          saleDate: "2026-10-17",
          dueDate: "2026-10-17",
          tripName: "Outubro",
          tripCity: "Campinas",
        },
        {
          id: "sale-overdue",
          clientId: "client-1",
          total: 90,
          amountPaid: 0,
          pendingAmount: 90,
          saleDate: "2026-10-01",
          dueDate: "2026-10-16",
        },
      ],
      products: [
        { id: "product-low", name: "Camisa", quantity: 2 },
        { id: "product-ok", name: "Calça", quantity: 4 },
      ],
      expenses: [
        { id: "expense-today", value: 15, expenseDate: "2026-10-17" },
      ],
      payments: [
        {
          saleId: "sale-today",
          value: 10,
          createdAt: new Date(2026, 9, 17, 10),
        },
      ],
      legacyPayments: [
        { value: 5, createdAt: new Date(2026, 9, 17, 11) },
      ],
    },
    today
  );

  assert.equal(snapshot.salesToday.length, 1);
  assert.equal(snapshot.salesToday[0].clientName, "Ana");
  assert.equal(snapshot.salesTodayTotal, 120);
  assert.equal(snapshot.receivedToday, 45);
  assert.equal(snapshot.expensesTodayTotal, 15);
  assert.equal(snapshot.overdueSales.length, 1);
  assert.equal(snapshot.dueSoonSales.length, 1);
  assert.equal(snapshot.lowStockProducts.length, 1);
  assert.equal(snapshot.legacyDebtors[0].clientName, "Bia");
});

test("does not count payments on a different day as today's receipts", () => {
  const snapshot = createSecretarySnapshot(
    {
      sales: [
        {
          id: "sale",
          amountPaid: 0,
          pendingAmount: 10,
          saleDate: "2026-10-16",
        },
      ],
      payments: [
        { saleId: "sale", value: 25, createdAt: new Date(2026, 9, 16, 14) },
      ],
    },
    today
  );

  assert.equal(snapshot.receivedToday, 0);
  assert.equal(snapshot.receivedThisMonth, 25);
});

test("reports personal withdrawals separately from operating expenses", () => {
  const snapshot = createSecretarySnapshot(
    {
      expenses: [
        { id: "meal", category: "merenda", value: 25, tripNumber: 4, expenseDate: "2026-10-17" },
        { id: "personal", category: "pessoal", kind: "personal_withdrawal", value: 40, tripNumber: 4, expenseDate: "2026-10-17" },
      ],
    },
    today
  );

  assert.equal(snapshot.expensesTodayTotal, 25);
  assert.equal(snapshot.personalWithdrawalsTodayTotal, 40);
  assert.equal(snapshot.tripFinancials[4].expenses, 25);
  assert.equal(snapshot.tripFinancials[4].personalWithdrawals, 40);
  assert.equal(snapshot.tripExpenseCategories[4].pessoal, undefined);
  assert.equal(snapshot.tripPersonalWithdrawals[4], 40);
  assert.match(answerSecretaryQuery("resumo de hoje", snapshot), /Retirada pessoal de hoje: R\$\s?40,00/);
  assert.match(answerSecretaryQuery("retirada pessoal", snapshot), /no histórico: R\$\s?40,00/);
  assert.match(answerSecretaryQuery("despesas merenda de todas as viagens", snapshot), /merenda.*R\$\s?25,00/i);
});

test("answers different receivable phrasings with the consolidated live total", () => {
  const snapshot = createSecretarySnapshot(
    {
      clients: [
        { id: "legacy-a", name: "Cliente A", totalDebt: 80 },
        { id: "legacy-b", name: "Cliente B", totalDebt: 20 },
        { id: "purchase-client", name: "Cliente C", totalDebt: 35 },
      ],
      sales: [
        {
          id: "legacy-sale-a",
          clientId: "legacy-a",
          pendingAmount: 80,
          amountPaid: 20,
          saleDate: "2026-10-10",
        },
        {
          id: "open-purchase",
          clientId: "purchase-client",
          balanceModel: "per-sale",
          pendingAmount: 35,
          amountPaid: 15,
          saleDate: "2026-10-10",
        },
      ],
    },
    today
  );
  const variations = [
    "Quanto tenho para receber dos meus clientes no total?",
    "Qual é o saldo pendente total dos clientes?",
    "Qual é a dívida total dos meus clientes?",
  ];

  assert.equal(snapshot.totalPending, 170);
  for (const question of variations) {
    const answer = answerSecretaryQuery(question, snapshot);
    assert.match(answer, /Total consolidado a receber/);
    assert.match(answer, /170,00/);
    assert.doesNotMatch(answer, /Recebimentos registrados hoje/);
  }
  for (const question of [
    "Quanto os clientes ainda me devem?",
    "Qual o valor em aberto com os clientes?",
    "Quanto devo receber dos clientes?",
  ]) {
    assert.match(
      answerSecretaryQuery(question, snapshot),
      /viagem específica ou o total geral/
    );
  }
});

test("distinguishes received amounts, sales, receivables and collection lists", () => {
  const snapshot = createSecretarySnapshot(
    {
      clients: [{ id: "client-1", name: "Cliente A", totalDebt: 70 }],
      sales: [
        {
          id: "sale-1",
          clientId: "client-1",
          clientName: "Cliente A",
          total: 120,
          amountPaid: 45,
          pendingAmount: 75,
          saleDate: "2026-10-17",
        },
      ],
    },
    today
  );
  const receivedVariations = [
    "Quanto recebi hoje?",
    "Qual foi o valor que entrou hoje?",
    "Quanto caiu hoje?",
    "Quais foram as entradas de hoje?",
  ];

  for (const question of receivedVariations) {
    assert.match(
      answerSecretaryQuery(question, snapshot),
      /Recebimentos registrados hoje/
    );
  }

  assert.match(
    answerSecretaryQuery("Quanto vendi hoje?", snapshot),
    /venda\(s\), total de/
  );
  assert.match(
    answerSecretaryQuery("Quanto falta receber desta venda?", snapshot),
    /viagem específica ou o total geral/
  );
  assert.match(
    answerSecretaryQuery("Quem devo cobrar?", snapshot),
    /viagem específica ou o total geral/
  );
  assert.match(
    answerSecretaryQuery("Quanto recebi no total?", snapshot),
    /recebimentos vinculados às vendas/
  );
});

test("answers supported data queries without treating unsupported questions as AI", () => {
  const snapshot = createSecretarySnapshot({}, today);

  assert.match(answerSecretaryQuery("Resumo de hoje", snapshot), /Resumo de hoje/);
  assert.match(
    answerSecretaryQuery("Quem devo cobrar?", snapshot),
    /viagem específica ou o total geral/
  );
  assert.match(
    answerSecretaryQuery("Quanto recebi?", snapshot),
    /viagem específica ou o total geral/
  );
  assert.match(answerSecretaryQuery("Me dê uma previsão complexa", snapshot), /IA conversacional ainda não tenho|Ainda não tenho uma IA/);
});

test("keeps selected trip context for chained questions and marks candidate trips provisional", () => {
  const snapshot = createSecretarySnapshot(
    {
      clients: [{ id: "client-a", name: "Ana" }],
      sales: [
        {
          id: "third-sale",
          clientId: "client-a",
          clientName: "Ana",
          saleDate: "2026-08-10",
          total: 300,
          amountPaid: 100,
          pendingAmount: 200,
        },
        {
          id: "fourth-sale",
          clientId: "client-a",
          clientName: "Ana",
          saleDate: "2026-10-10",
          total: 500,
          amountPaid: 250,
          pendingAmount: 250,
        },
      ],
    },
    today
  );

  const first = answerSecretaryQueryWithContext(
    "Quanto recebi na 4ª viagem?",
    snapshot
  );
  assert.equal(first.tripContext, 4);
  assert.match(first.answer, /4ª viagem.*01\/10 a 31\/12\/2026/);
  assert.match(first.answer, /provisória/);
  assert.match(first.answer, /R\$.*250,00/);

  const followUp = answerSecretaryQueryWithContext(
    "E quanto falta receber?",
    snapshot,
    undefined,
    first.tripContext
  );
  assert.equal(followUp.tripContext, 4);
  assert.match(followUp.answer, /4ª viagem/);
  assert.match(followUp.answer, /R\$.*250,00/);
  assert.doesNotMatch(followUp.answer, /R\$.*200,00/);

  const explicitTripOverridesAllContext = answerSecretaryQueryWithContext(
    "Quanto vendi na 4ª viagem no total?",
    snapshot,
    undefined,
    "all"
  );
  assert.equal(explicitTripOverridesAllContext.tripContext, 4);
  assert.match(explicitTripOverridesAllContext.answer, /4ª viagem/);
  assert.match(explicitTripOverridesAllContext.answer, /R\$.*500,00/);
});

test("asks for trip scope when a financial question has no trip context", () => {
  const snapshot = createSecretarySnapshot({}, today);
  const questions = [
    "Quanto vendi?",
    "Quanto falta receber?",
    "Quanto gastei de combustível?",
    "Quais clientes estão devendo?",
  ];

  for (const question of questions) {
    assert.match(
      answerSecretaryQuery(question, snapshot),
      /viagem específica ou o total geral/
    );
  }
});

test("understands trip-period phrases, fuel category, debtor lists and all-trip totals", () => {
  const snapshot = createSecretarySnapshot(
    {
      clients: [{ id: "client-a", name: "Ana" }],
      sales: [
        {
          id: "third-sale",
          clientId: "client-a",
          clientName: "Ana",
          saleDate: "2026-08-10",
          total: 300,
          amountPaid: 100,
          pendingAmount: 200,
        },
        {
          id: "fourth-sale",
          clientId: "client-a",
          clientName: "Ana",
          saleDate: "2026-10-10",
          total: 500,
          amountPaid: 250,
          pendingAmount: 250,
        },
      ],
      expenses: [
        { id: "fuel-fourth", tripNumber: 4, category: "combustivel", value: 80 },
        { id: "food-fourth", tripNumber: 4, category: "alimentacao", value: 20 },
        { id: "unassigned", category: "combustivel", value: 400 },
      ],
    },
    today
  );

  assert.match(
    answerSecretaryQuery(
      "Quanto falta receber da viagem de julho a setembro?",
      snapshot
    ),
    /3ª viagem.*01\/07 a 30\/09\/2026.*R\$.*200,00/
  );
  const fourthTripDebtors = answerSecretaryQuery(
    "Quais clientes estão devendo na viagem de outubro a dezembro?",
    snapshot
  );
  assert.match(fourthTripDebtors, /Ana \(R\$.*250,00\)/);
  assert.match(fourthTripDebtors, /provisória/);
  assert.match(
    answerSecretaryQuery("Quanto gastei de combustível na 4ª viagem?", snapshot),
    /4ª viagem.*combustível.*R\$.*80,00/
  );
  assert.match(
    answerSecretaryQuery("Quanto vendi em todas as viagens?", snapshot),
    /total vendido de R\$.*800,00/
  );
  assert.match(
    answerSecretaryQueryWithContext("Quanto recebi em outubro?", snapshot).answer,
    /viagem específica ou o total geral/
  );
});

test("ranks trips by profit only when cost data is complete", () => {
  const snapshot = createSecretarySnapshot(
    {
      sales: [
        {
          id: "third",
          saleDate: "2026-08-01",
          total: 300,
          amountPaid: 150,
          pendingAmount: 150,
          items: [{ productId: "item", quantity: 2 }],
        },
        {
          id: "fourth",
          saleDate: "2026-10-01",
          total: 500,
          amountPaid: 200,
          pendingAmount: 300,
          items: [{ productId: "item", quantity: 2 }],
        },
      ],
      products: [{ id: "item", costPrice: 40 }],
      expenses: [
        { tripNumber: 3, value: 50 },
        { tripNumber: 4, value: 260 },
      ],
    },
    today
  );

  assert.match(
    answerSecretaryQuery("Qual viagem teve mais lucro?", snapshot),
    /maior lucro estimado.*3ª viagem.*R\$/
  );
});

test("does not claim a highest-profit trip when another trip has missing costs", () => {
  const snapshot = createSecretarySnapshot(
    {
      sales: [
        {
          id: "complete",
          saleDate: "2026-08-01",
          total: 300,
          amountPaid: 100,
          pendingAmount: 200,
          items: [{ productId: "item", quantity: 2 }],
        },
        {
          id: "missing-cost",
          saleDate: "2026-10-01",
          total: 500,
          amountPaid: 200,
          pendingAmount: 300,
          items: [{ productId: "unpriced-item", quantity: 2 }],
        },
      ],
      products: [{ id: "item", costPrice: 40 }],
    },
    today
  );

  assert.match(
    answerSecretaryQuery("Qual viagem teve mais lucro?", snapshot),
    /Não é possível identificar com segurança.*custos cadastrados.*4ª/
  );
});

test("answers trip expense, estimated profit and highest trip revenue from assigned data", () => {
  const snapshot = createSecretarySnapshot(
    {
      sales: [
        {
          id: "sale-third",
          saleDate: "2026-07-10",
          total: 300,
          amountPaid: 100,
          pendingAmount: 200,
          items: [{ productId: "item-1", quantity: 2 }],
        },
        {
          id: "sale-fourth",
          saleDate: "2026-10-10",
          total: 500,
          amountPaid: 250,
          pendingAmount: 250,
          items: [{ productId: "item-1", quantity: 2 }],
        },
      ],
      products: [{ id: "item-1", costPrice: 50 }],
      expenses: [
        { id: "assigned", tripNumber: 3, value: 40 },
        { id: "unassigned", value: 100 },
      ],
    },
    today
  );

  assert.equal(snapshot.tripFinancials[3].expenses, 40);
  assert.equal(snapshot.tripFinancials[3].estimatedProfit, 160);
  assert.equal(snapshot.tripFinancials[3].cashFlow, 60);
  assert.equal(snapshot.tripFinancials[4].expenses, 0);
  assert.match(
    answerSecretaryQuery("Quanto gastei na terceira viagem?", snapshot),
    /3ª viagem.*total de despesas vinculadas à viagem: R\$.*40,00/
  );
  assert.match(
    answerSecretaryQuery("Quanto lucrei na terceira viagem?", snapshot),
    /Lucro estimado.*R\$.*160,00.*Fluxo de caixa simplificado.*R\$.*60,00/
  );
  assert.match(
    answerSecretaryQuery("Qual viagem teve maior faturamento?", snapshot),
    /maior faturamento é a 4ª viagem.*500,00/
  );
});

test("keeps existing intelligence calculations available as private chat queries", () => {
  const snapshot = createSecretarySnapshot({}, today);
  const intelligence = {
    monthSales: 1200,
    grossProfit: 800,
    netProfit: 650,
    averageTicket: 300,
    forecastMonth: 2400,
    goalProgress: 40,
    remainingGoal: 18000,
    likelyToBuyAgain: [
      { name: "Ana", score: 8, daysSinceLastPurchase: 30 },
    ],
    bestClients: [{ name: "Bia", totalBought: 900 }],
    slowProducts: [],
    bestCities: [{ city: "Campinas", totalSales: 500, salesCount: 3 }],
    bestProducts: [{ name: "Blusa", quantitySold: 12 }],
    lowStockProducts: [
      { name: "Saia", stock: 1, suggestedRestock: 5 },
    ],
    alerts: [{ title: "Meta mensal", description: "Faltam R$ 100." }],
  };

  assert.match(
    answerSecretaryQuery(
      "Qual o faturamento e lucro do mês?",
      snapshot,
      intelligence
    ),
    /R\$/
  );
  assert.match(
    answerSecretaryQuery("Qual meu ticket médio?", snapshot, intelligence),
    /300/
  );
  assert.match(
    answerSecretaryQuery("Quais clientes têm chance de recompra?", snapshot, intelligence),
    /Ana/
  );
  assert.match(
    answerSecretaryQuery("Qual é a melhor cidade?", snapshot, intelligence),
    /Campinas/
  );
  assert.match(
    answerSecretaryQuery("Qual o produto mais vendido?", snapshot, intelligence),
    /Blusa/
  );
  assert.match(
    answerSecretaryQuery("O que preciso repor?", snapshot, intelligence),
    /Saia/
  );
  assert.match(
    answerSecretaryQuery("Quais são os alertas?", snapshot, intelligence),
    /Meta mensal/
  );
});

test("answers supplier payable, creditor, overdue installment, and dated check queries", () => {
  const snapshot = createSecretarySnapshot(
    {
      suppliers: [
        { id: "supplier-a", name: "Confecções Alfa" },
        { id: "supplier-b", name: "Malhas Beta" },
      ],
      payables: [
        {
          id: "account-a",
          supplierId: "supplier-a",
          description: "Tecidos",
          totalAmount: 1000,
          paidAmount: 200,
          tripNumber: 4,
          installments: [
            {
              id: "late",
              amount: 300,
              paidAmount: 100,
              dueDate: "2026-10-10",
              method: "boleto",
              identification: "B-12",
            },
            {
              id: "check-nov",
              amount: 500,
              paidAmount: 0,
              dueDate: "2026-11-15",
              method: "cheque",
              identification: "0042",
            },
          ],
        },
        {
          id: "account-b",
          supplierId: "supplier-b",
          description: "Aviamentos",
          totalAmount: 250,
          paidAmount: 50,
          installments: [
            {
              id: "check-oct",
              amount: 200,
              paidAmount: 0,
              dueDate: "2026-10-30",
              method: "cheque",
              identification: "0099",
            },
          ],
        },
      ],
    },
    today
  );

  assert.match(
    answerSecretaryQuery("Quanto devo aos fornecedores?", snapshot),
    /Saldo total a pagar aos fornecedores: R\$.*1\.000,00/
  );
  assert.match(
    answerSecretaryQuery("A quem devo e quanto?", snapshot),
    /Confecções Alfa:[\s\S]*800,00[\s\S]*Malhas Beta:[\s\S]*200,00/
  );
  assert.match(
    answerSecretaryQuery("Quais parcelas estão vencidas?", snapshot),
    /Parcelas e títulos vencidos: R\$.*200,00[\s\S]*Confecções Alfa.*B-12/
  );
  assert.match(
    answerSecretaryQuery("Quais cheques vencem em novembro?", snapshot),
    /novembro de 2026[\s\S]*Confecções Alfa, cheque 0042/
  );
  assert.match(
    answerSecretaryQuery(
      "Quais cheques vencem entre 01/11/2026 e 30/11/2026?",
      snapshot
    ),
    /01\/11\/2026 a 30\/11\/2026[\s\S]*Confecções Alfa, cheque 0042/
  );
  assert.match(
    answerSecretaryQuery("Quanto devo aos fornecedores na 4ª viagem?", snapshot),
    /R\$.*800,00[\s\S]*4ª viagem[\s\S]*provisória/
  );
  const tripContext = answerSecretaryQueryWithContext(
    "Quanto vendi na 4ª viagem?",
    snapshot
  );
  const chainedPayableAnswer = answerSecretaryQueryWithContext(
    "Quanto devo aos fornecedores?",
    snapshot,
    undefined,
    tripContext.tripContext
  ).answer;
  assert.match(chainedPayableAnswer, /Visão: 4ª viagem/);
  assert.match(
    chainedPayableAnswer,
    /R\$.*800,00/
  );
});
