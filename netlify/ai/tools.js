import { createSecretarySnapshot } from "../../src/domain/secretary.js";
import {
  buildCollectionsReport,
  resolveDueDate,
} from "../../src/domain/secretaryCollections.js";
import {
  getSalePendingAmount,
  groupReceivablesByCity,
} from "../../src/domain/financeReceivables.js";
import {
  calculateConsolidatedReceivables,
  calculateTripFinancialSummary,
} from "../../src/domain/sales.js";
import { filterPayablesByTrip, summarizePayables } from "../../src/domain/payables.js";
import { getStockThresholds, getSuggestedRestock } from "../../src/domain/stock.js";
import { getClientCityDisplay } from "../../src/domain/clientCities.js";
import { filterRecordsByTrip, getTripOptionLabel, getTripSelectionLabel } from "../../src/domain/tripIdentity.js";

const MAX_ITEMS = 25;
const money = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const dateText = (value) =>
  value instanceof Date && !Number.isNaN(value.getTime())
    ? value.toLocaleDateString("pt-BR")
    : null;
const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();

const TRIP_ENUM = ["1", "2", "3", "4", "todas"];
const EXPENSE_CATEGORIES = [
  "combustivel", "alimentacao", "hotel", "manutencao",
  "transporte", "mercadoria", "outros",
];

export class ToolInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolInputError";
  }
}

function parseTrip(args, snapshot) {
  const trip = args.viagem === undefined || args.viagem === null ? "todas" : String(args.viagem);
  if (!TRIP_ENUM.includes(trip)) throw new ToolInputError("viagem inválida");
  if (trip === "todas") return "all";
  if (args.ano !== undefined && (!Number.isInteger(args.ano) || args.ano < 2000 || args.ano > 2100)) {
    throw new ToolInputError("ano da viagem inválido");
  }
  const candidates = snapshot.tripOptions.filter((option) =>
    option.tripNumber === Number(trip) && (!args.ano || option.tripYear === args.ano)
  );
  if (args.referencia) {
    const selected = candidates.find((option) => option.id === args.referencia);
    if (!selected) throw new ToolInputError("referência de viagem inválida");
    return selected;
  }
  if (candidates.length > 1) throw new ToolInputError(
    `Viagem ambígua; confirme ano e referência: ${candidates.map((option) => getTripSelectionLabel(option, snapshot.tripOptions)).join("; ")}`
  );
  return candidates[0] || {
    id: `legacy-number-${trip}${args.ano ? `-${args.ano}` : ""}`,
    tripNumber: Number(trip), tripYear: args.ano || null, reviewRequired: true,
  };
}

function tripLabel(trip) {
  return trip === "all"
    ? "Todas as viagens (total geral)"
    : getTripOptionLabel(trip);
}

function limited(items) {
  return {
    itens: items.slice(0, MAX_ITEMS),
    itens_omitidos: Math.max(items.length - MAX_ITEMS, 0),
  };
}

const tripProperty = {
  type: "string",
  enum: TRIP_ENUM,
  description: "Número da viagem consultada: 1, 2, 3, 4 ou todas. Use ano quando informado.",
};
const tripProperties = {
  viagem: tripProperty,
  ano: { type: "integer", minimum: 2000, maximum: 2100 },
  referencia: { type: "string", description: "ID existente, somente para distinguir vínculos ambíguos; nunca deduza pela data." },
};

export const TOOL_DEFINITIONS = [
  {
    name: "listar_cobrancas",
    description:
      "Cobranças pendentes de clientes, separadas em vencidas, vencem hoje, próximas a vencer e sem vencimento confiável. Os valores já descontam pagamentos recebidos.",
    parameters: {
      type: "object",
      properties: {
        ...tripProperties,
        foco: {
          type: "string",
          enum: ["hoje", "todas"],
          description: "Use 'hoje' quando o usuário perguntar quem cobrar hoje.",
        },
      },
      required: ["viagem"],
      additionalProperties: false,
    },
  },
  {
    name: "resumo_pendente_por_viagem",
    description: "Total pendente geral e saldo separado por vínculo de viagem e ano.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "recebimentos_por_cidade",
    description:
      "Valores a receber e já recebidos por cidade cadastrada do cliente, com os clientes devedores de cada cidade.",
    parameters: {
      type: "object",
      properties: tripProperties,
      required: ["viagem"],
      additionalProperties: false,
    },
  },
  {
    name: "resumo_vendas",
    description:
      "Vendas, recebido, pendente, despesas, lucro estimado e fluxo de caixa de uma viagem. Lucro estimado não é dinheiro em caixa.",
    parameters: {
      type: "object",
      properties: tripProperties,
      required: ["viagem"],
      additionalProperties: false,
    },
  },
  {
    name: "consultar_cliente",
    description: "Saldo e vendas em aberto de um cliente, pelo nome.",
    parameters: {
      type: "object",
      properties: { nome: { type: "string", maxLength: 80 } },
      required: ["nome"],
      additionalProperties: false,
    },
  },
  {
    name: "estoque",
    description: "Situação do estoque: resumo, estoque baixo ou produtos sem estoque.",
    parameters: {
      type: "object",
      properties: {
        filtro: { type: "string", enum: ["resumo", "baixo", "sem_estoque"] },
      },
      required: ["filtro"],
      additionalProperties: false,
    },
  },
  {
    name: "despesas",
    description: "Despesas totais e por categoria, de uma viagem ou de todas.",
    parameters: {
      type: "object",
      properties: {
        ...tripProperties,
        categoria: { type: "string", enum: EXPENSE_CATEGORIES },
      },
      required: ["viagem"],
      additionalProperties: false,
    },
  },
  {
    name: "fornecedores_contas_a_pagar",
    description:
      "Contas a pagar a fornecedores: total devido, vencidas, a vencer e saldo por fornecedor.",
    parameters: {
      type: "object",
      properties: tripProperties,
      additionalProperties: false,
    },
  },
].map((definition) => ({ type: "function", function: definition }));

export function createToolContext(data, now = new Date()) {
  return {
    now,
    data,
    snapshot: createSecretarySnapshot(
      {
        clients: data.clients,
        sales: data.sales,
        products: data.products,
        expenses: data.expenses,
        suppliers: data.suppliers,
        payables: data.payables,
      },
      now
    ),
  };
}

function sanitizeReportForUi(report) {
  const clean = (group) => ({
    count: group.count,
    total: group.total,
    items: group.items.map((item) => ({
      clientName: item.clientName,
      city: item.city,
      pending: item.pending,
      dueDate: item.dueDate ? item.dueDate.toISOString() : null,
      dueLabel: item.dueLabel,
      dueNote: item.dueNote,
      daysLate: item.daysLate,
      daysUntil: item.daysUntil,
      legacy: item.legacy,
    })),
  });
  return {
    trip: report.trip,
    overdue: clean(report.overdue),
    today: clean(report.today),
    upcoming: clean(report.upcoming),
    noDueDate: clean(report.noDueDate),
  };
}

function collectionItems(items, kind) {
  return limited(
    items.map((item) => ({
      cliente: item.clientName,
      cidade: item.city,
      saldo_pendente: item.pending,
      vencimento: item.dueDate ? item.dueLabel : "Vencimento não informado",
      vencimento_estimado_90_dias: item.dueSource === "estimated",
      ...(kind === "overdue" ? { dias_de_atraso: item.daysLate } : {}),
      ...(kind === "upcoming" ? { dias_para_vencer: item.daysUntil } : {}),
    }))
  );
}

const handlers = {
  listar_cobrancas(args, { snapshot, now }) {
    const trip = parseTrip(args, snapshot);
    const focus = args.foco === "hoje" ? "hoje" : "todas";
    const report = buildCollectionsReport({
      clients: snapshot.collectionClients,
      sales: snapshot.collectionSales,
      today: now,
      trip,
    });
    const group = (data, kind) => ({
      quantidade: data.count,
      total: data.total,
      ...collectionItems(data.items, kind),
    });

    return {
      result: {
        escopo: tripLabel(trip),
        classificacao_provisoria: Boolean(trip?.reviewRequired),
        foco: focus,
        vencidas: group(report.overdue, "overdue"),
        vencem_hoje: group(report.today, "today"),
        proximas_a_vencer: {
          ...group(report.upcoming, "upcoming"),
          observacao:
            focus === "hoje"
              ? "Apenas para planejamento; não são cobranças de hoje."
              : undefined,
        },
        sem_vencimento_confiavel: group(report.noDueDate, "nodate"),
      },
      ui: {
        report: sanitizeReportForUi(report),
        focusToday: focus === "hoje",
        tripLabel: tripLabel(trip),
        provisional: Boolean(trip?.reviewRequired),
      },
    };
  },

  resumo_pendente_por_viagem(_args, { snapshot }) {
    return {
      result: {
        total_pendente_geral: money(snapshot.totalPending),
        terceira_viagem: snapshot.tripPending[3],
        quarta_viagem: snapshot.tripPending[4],
        viagens: snapshot.tripOptions.map((trip) => ({
          referencia: trip.id, viagem: getTripSelectionLabel(trip, snapshot.tripOptions),
          ...snapshot.tripPending[trip.id],
        })),
        classificacao_provisoria: snapshot.tripOptions.some((trip) => trip.reviewRequired),
        observacao:
          "O total geral inclui saldos antigos e vendas sem viagem; anos não são deduzidos de datas.",
      },
    };
  },

  recebimentos_por_cidade(args, { data, snapshot }) {
    const trip = parseTrip(args, snapshot);
    const sales = filterRecordsByTrip(data.sales, trip, snapshot.tripOptions);
    const cities = groupReceivablesByCity(data.clients, sales, trip === "all");
    return {
      result: {
        escopo: tripLabel(trip),
        cidades: cities.slice(0, MAX_ITEMS).map((city) => ({
          cidade: city.city,
          clientes_com_saldo: city.clientsWithPending,
          a_receber: city.totalToReceive,
          ja_recebido: city.received,
          clientes: city.clients.slice(0, 10).map((client) => ({
            cliente: client.clientName,
            saldo_pendente: client.totalPending,
          })),
        })),
      },
    };
  },

  resumo_vendas(args, { snapshot, data }) {
    const trip = parseTrip(args, snapshot);
    const financials =
      trip === "all" ? snapshot.allTripFinancials : calculateTripFinancialSummary(
        filterRecordsByTrip(data.sales, trip, snapshot.tripOptions),
        filterRecordsByTrip(data.expenses, trip, snapshot.tripOptions),
        data.products, filterPayablesByTrip(snapshot.payables, trip)
      );
    return {
      result: {
        escopo: tripLabel(trip),
        quantidade_de_vendas: financials.salesCount,
        total_vendido: money(financials.sold),
        total_recebido: money(financials.received),
        total_pendente: money(financials.pending),
        despesas: money(financials.expenses),
        custo_das_mercadorias: money(financials.costOfGoodsSold),
        lucro_estimado: money(financials.estimatedProfit),
        fluxo_de_caixa_simplificado: money(financials.cashFlow),
        custos_completos: financials.hasCompleteCostData,
        observacao:
          "Lucro estimado não é dinheiro disponível em caixa; o fluxo de caixa considera apenas recebimentos menos despesas e pagamentos a fornecedores.",
      },
    };
  },

  consultar_cliente(args, { data, now }) {
    const wanted = normalize(args.nome);
    if (wanted.length < 2) throw new ToolInputError("nome muito curto");
    const matches = data.clients
      .filter((client) => normalize(client.name).includes(wanted))
      .slice(0, 5);
    const receivables = calculateConsolidatedReceivables(data.clients, data.sales);
    const balances = new Map(
      receivables.clients.map((client) => [client.clientId, client])
    );

    return {
      result: {
        encontrados: matches.length,
        clientes: matches.map((client) => {
          const balance = balances.get(client.id);
          const openSales = data.sales
            .filter(
              (sale) => sale.clientId === client.id && getSalePendingAmount(sale) > 0
            )
            .map((sale) => {
              const due = resolveDueDate(sale);
              return {
                total: money(sale.total),
                recebido: money(sale.amountPaid),
                saldo_pendente: getSalePendingAmount(sale),
                vencimento: dateText(due.date) || "Vencimento não informado",
                vencimento_estimado_90_dias: due.source === "estimated",
              };
            });
          return {
            cliente: client.name,
            cidade: client.city
              ? getClientCityDisplay(client.city)
              : "Cidade não informada",
            total_pendente: money(balance?.totalPending),
            saldo_anterior_sem_venda: money(balance?.legacyBalance),
            vendas_em_aberto: openSales.slice(0, 10),
          };
        }),
        data_consulta: dateText(now),
      },
    };
  },

  estoque(args, { data }) {
    const filter = ["resumo", "baixo", "sem_estoque"].includes(args.filtro)
      ? args.filtro
      : "resumo";
    const rows = data.products.map((product) => {
      const quantity = Math.max(Math.floor(Number(product.quantity) || 0), 0);
      const { minimum } = getStockThresholds(product);
      return {
        produto: product.name || "Produto sem nome",
        categoria: product.category || "",
        tamanho: product.size || "",
        quantidade: quantity,
        minimo: minimum,
        reposicao_sugerida: getSuggestedRestock(product),
        custo: Number(product.costPrice) || 0,
        venda: Number(product.salePrice) || 0,
      };
    });
    const strip = ({ custo, venda, ...rest }) => rest; // eslint-disable-line no-unused-vars
    const out = rows.filter((row) => row.quantidade === 0);
    const low = rows.filter((row) => row.quantidade > 0 && row.quantidade <= row.minimo);

    const result = {
      produtos_cadastrados: rows.length,
      pecas_em_estoque: rows.reduce((sum, row) => sum + row.quantidade, 0),
      produtos_sem_estoque: out.length,
      produtos_com_estoque_baixo: low.length,
      valor_investido: money(rows.reduce((sum, row) => sum + row.quantidade * row.custo, 0)),
      valor_potencial_de_venda: money(
        rows.reduce((sum, row) => sum + row.quantidade * row.venda, 0)
      ),
      observacao: "O valor potencial de venda não é lucro realizado.",
    };
    if (filter === "baixo") Object.assign(result, limited(low.map(strip)));
    if (filter === "sem_estoque") Object.assign(result, limited(out.map(strip)));
    return { result };
  },

  despesas(args, { data, snapshot }) {
    const trip = parseTrip(args, snapshot);
    const category = EXPENSE_CATEGORIES.includes(args.categoria) ? args.categoria : null;
    const expenses = filterRecordsByTrip(data.expenses, trip, snapshot.tripOptions).filter(
      (expense) =>
        (!category || String(expense.category || "outros") === category)
    );
    const byCategory = {};
    for (const expense of expenses) {
      const key = String(expense.category || "outros");
      byCategory[key] = money((byCategory[key] || 0) + Number(expense.value || 0));
    }
    return {
      result: {
        escopo: tripLabel(trip),
        categoria: category || "todas",
        quantidade: expenses.length,
        total: money(expenses.reduce((sum, e) => sum + Number(e.value || 0), 0)),
        por_categoria: byCategory,
      },
    };
  },

  fornecedores_contas_a_pagar(args, { snapshot, now }) {
    const trip = parseTrip(args, snapshot);
    const payables = filterPayablesByTrip(
      snapshot.payables,
      trip
    );
    const summary = summarizePayables(payables, now);
    const grouped = new Map();
    for (const payable of summary.active) {
      if (!(payable.balance > 0)) continue;
      const name = payable.supplierName || "Fornecedor não informado";
      const entry = grouped.get(name) || { fornecedor: name, saldo: 0, contas: 0 };
      entry.saldo = money(entry.saldo + payable.balance);
      entry.contas += 1;
      grouped.set(name, entry);
    }
    return {
      result: {
        escopo: tripLabel(trip),
        total_a_pagar: summary.totalToPay,
        total_ja_pago: summary.totalPaid,
        vencidas: { quantidade: summary.overdueCount, total: summary.overdueTotal },
        a_vencer_30_dias: {
          quantidade: summary.upcomingCount,
          total: summary.upcomingTotal,
        },
        fornecedores: limited(
          [...grouped.values()].sort((a, b) => b.saldo - a.saldo)
        ).itens,
        parcelas_vencidas: limited(
          summary.overdueItems.map((item) => ({
            fornecedor: item.supplierName,
            vencimento: dateText(item.dueDate),
            valor: item.amount,
          }))
        ).itens,
      },
    };
  },
};

export function runTool(name, rawArguments, context) {
  const handler = handlers[name];
  if (!handler) throw new ToolInputError("ferramenta desconhecida");

  let args = {};
  if (rawArguments && rawArguments !== "") {
    try {
      args = typeof rawArguments === "string" ? JSON.parse(rawArguments) : rawArguments;
    } catch {
      throw new ToolInputError("argumentos inválidos");
    }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new ToolInputError("argumentos inválidos");
  }
  return handler(args, context);
}
