import { toDate } from "../utils/dates.js";

const cents = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100);
const amountFromCents = (value) => Math.round(value) / 100;

export const CHECK_STATUSES = {
  ISSUED: "issued",
  COMPENSATED: "compensated",
  RETURNED: "returned",
  CANCELLED: "cancelled",
};

export function getCheckStatus(installment) {
  if (installment?.method !== "cheque") return null;
  if (Object.values(CHECK_STATUSES).includes(installment.checkStatus)) {
    return installment.checkStatus;
  }
  const remaining = Math.max(
    cents(installment.amount) - cents(installment.paidAmount),
    0
  );
  return remaining === 0 ? CHECK_STATUSES.COMPENSATED : CHECK_STATUSES.ISSUED;
}

export function summarizeChecks(payables = [], today = new Date()) {
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const checks = payables.flatMap((payable) =>
    (payable.installments || [])
      .filter((installment) => installment.method === "cheque")
      .map((installment) => ({
        payableId: payable.id,
        supplierId: payable.supplierId,
        supplierName: payable.supplierName || "Fornecedor não informado",
        description: payable.description || "Compra",
        tripNumber: payable.tripNumber || null,
        installment,
        checkNumber: installment.identification || "",
        bankAccount: installment.bankAccount || "",
        dueDate: toDate(installment.dueDate),
        amount: amountFromCents(
          Math.max(
            cents(installment.amount) - cents(installment.paidAmount),
            0
          )
        ),
        status: getCheckStatus(installment),
      }))
  );
  const upcomingTotals = [7, 15, 30].map((days) => {
    const endExclusive = new Date(startOfToday);
    endExclusive.setDate(endExclusive.getDate() + days + 1);
    return {
      days,
      total: amountFromCents(
        checks.reduce((sum, check) => {
          if (
            check.status !== CHECK_STATUSES.ISSUED ||
            !check.dueDate ||
            check.dueDate < startOfToday ||
            check.dueDate >= endExclusive
          ) {
            return sum;
          }
          return sum + cents(check.amount);
        }, 0)
      ),
    };
  });

  return { checks, upcomingTotals };
}

export function reusePayablePaymentOperation(
  previousOperation,
  fingerprint,
  createReference
) {
  if (
    previousOperation?.fingerprint === fingerprint &&
    previousOperation.paymentReference
  ) {
    return previousOperation;
  }
  const paymentReference = createReference();
  if (!paymentReference?.id) {
    throw new Error("Não foi possível identificar o pagamento.");
  }
  return { fingerprint, paymentReference };
}

export function getPayableBalance(payable) {
  const total = cents(payable.totalAmount);
  const paid = cents(payable.paidAmount);
  return amountFromCents(Math.max(total - paid, 0));
}

export function validatePayableSchedule(totalAmount, downPayment, installments) {
  const totalCents = cents(totalAmount);
  const downCents = cents(downPayment);
  const remainingCents = totalCents - downCents;

  if (!Number.isFinite(totalCents) || totalCents <= 0) {
    throw new Error("Informe um valor total maior que zero.");
  }
  if (!Number.isFinite(downCents) || downCents < 0 || downCents > totalCents) {
    throw new Error("A entrada deve estar entre zero e o valor total.");
  }
  if (!Array.isArray(installments)) {
    throw new Error("A lista de parcelas é inválida.");
  }
  if (remainingCents > 0 && installments.length === 0) {
    throw new Error("Cadastre as parcelas ou cheques que representam o saldo.");
  }

  let scheduleCents = 0;
  const checkNumbers = new Set();
  for (const installment of installments) {
    const amount = cents(installment.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Cada parcela deve ter um valor maior que zero.");
    }
    if (!toDate(installment.dueDate)) {
      throw new Error("Informe um vencimento válido para cada parcela.");
    }
    if (installment.method === "cheque") {
      const identification = String(installment.identification || "")
        .trim()
        .toLocaleLowerCase("pt-BR");
      if (!identification) {
        throw new Error("Informe o número de cada cheque.");
      }
      if (checkNumbers.has(identification)) {
        throw new Error("Cada cheque deve ter uma identificação própria.");
      }
      if (!["bb-pf", "bb-pj"].includes(installment.bankAccount)) {
        throw new Error("Selecione a conta PF ou PJ do Banco do Brasil para cada cheque.");
      }
      checkNumbers.add(identification);
    }
    scheduleCents += amount;
  }

  if (scheduleCents !== remainingCents) {
    throw new Error(
      "A soma das parcelas deve corresponder exatamente ao saldo após a entrada."
    );
  }

  return {
    totalAmount: amountFromCents(totalCents),
    paidAmount: amountFromCents(downCents),
    balance: amountFromCents(remainingCents),
  };
}

export function applyPaymentToPayable(payable, payment) {
  const paymentCents = cents(payment.amount);
  const balanceCents = cents(getPayableBalance(payable));
  if (!Number.isFinite(paymentCents) || paymentCents <= 0) {
    throw new Error("O pagamento deve ser maior que zero.");
  }
  if (paymentCents > balanceCents) {
    throw new Error("O pagamento não pode ser maior que o saldo devedor.");
  }

  const installments = (payable.installments || []).map((item) => ({ ...item }));
  const allocations = [];
  let remaining = paymentCents;
  const selectedIndex = payment.installmentId
    ? installments.findIndex((item) => item.id === payment.installmentId)
    : -1;

  if (payment.installmentId && selectedIndex < 0) {
    throw new Error("A parcela selecionada não pertence a esta conta.");
  }
  if (
    selectedIndex >= 0 &&
    getCheckStatus(installments[selectedIndex]) === CHECK_STATUSES.ISSUED &&
    !payment.allowCheckCompensation
  ) {
    throw new Error("Cheque emitido só pode ser baixado ao confirmar a compensação.");
  }

  const allocationIndexes =
    selectedIndex >= 0
      ? [selectedIndex]
      : installments
          .map((item, index) => ({ item, index }))
          .filter(
            ({ item }) =>
              cents(item.amount) > cents(item.paidAmount) &&
              !(
                getCheckStatus(item) === CHECK_STATUSES.ISSUED &&
                !payment.allowCheckCompensation
              )
          )
          .sort(
            (first, second) =>
              (toDate(first.item.dueDate)?.getTime() || 0) -
              (toDate(second.item.dueDate)?.getTime() || 0)
          )
          .map(({ index }) => index);

  for (const index of allocationIndexes) {
    if (remaining === 0) break;
    const installment = installments[index];
    const installmentBalance = Math.max(
      cents(installment.amount) - cents(installment.paidAmount),
      0
    );
    const allocated = Math.min(remaining, installmentBalance);
    if (allocated <= 0) continue;
    installment.paidAmount = amountFromCents(
      cents(installment.paidAmount) + allocated
    );
    installment.status =
      cents(installment.paidAmount) >= cents(installment.amount)
        ? "paid"
        : "partial";
    remaining -= allocated;
    allocations.push({
      installmentId: installment.id,
      amount: amountFromCents(allocated),
    });
  }

  const allocatedToInstallments = paymentCents - remaining;
  if (selectedIndex >= 0 && remaining > 0) {
    throw new Error("O pagamento excede o saldo desta parcela.");
  }
  if (remaining > 0 && installments.length > 0) {
    throw new Error(
      "O pagamento excede o saldo das parcelas em aberto; ajuste a parcela selecionada."
    );
  }
  if (selectedIndex < 0 && installments.length === 0) {
    allocations.push({ installmentId: null, amount: amountFromCents(paymentCents) });
  }

  const paidAmount = amountFromCents(
    cents(payable.paidAmount) + paymentCents
  );
  const balance = amountFromCents(balanceCents - paymentCents);

  return {
    paidAmount,
    balance,
    status: balance === 0 ? "paid" : "partial",
    installments,
    allocations,
    allocatedToInstallments: amountFromCents(allocatedToInstallments),
  };
}

export function applyCheckStatusTransition(
  payable,
  installmentId,
  nextStatus,
  changedAt = new Date()
) {
  if (
    ![
      CHECK_STATUSES.COMPENSATED,
      CHECK_STATUSES.RETURNED,
      CHECK_STATUSES.CANCELLED,
    ].includes(nextStatus)
  ) {
    throw new Error("Selecione um status de cheque válido.");
  }

  const installment = (payable.installments || []).find(
    (item) => item.id === installmentId
  );
  if (!installment || installment.method !== "cheque") {
    throw new Error("O cheque não pertence a esta conta.");
  }
  if (getCheckStatus(installment) !== CHECK_STATUSES.ISSUED) {
    throw new Error("Somente cheques emitidos podem mudar de status.");
  }

  const statusHistory = [
    ...(installment.checkStatusHistory || []),
    {
      status: nextStatus,
      changedAt,
    },
  ];

  if (nextStatus !== CHECK_STATUSES.COMPENSATED) {
    const installments = payable.installments.map((item) =>
      item.id === installmentId
        ? {
            ...item,
            checkStatus: nextStatus,
            checkStatusHistory: statusHistory,
          }
        : { ...item }
    );
    const balance = getPayableBalance(payable);
    return {
      paidAmount: cents(payable.paidAmount) / 100,
      balance,
      status:
        balance === 0
          ? "paid"
          : cents(payable.paidAmount) > 0
            ? "partial"
            : "pending",
      installments,
      allocations: [],
    };
  }

  const remaining = amountFromCents(
    Math.max(cents(installment.amount) - cents(installment.paidAmount), 0)
  );
  if (remaining <= 0) {
    throw new Error("Este cheque já está totalmente baixado.");
  }

  const paymentResult = applyPaymentToPayable(payable, {
    amount: remaining,
    installmentId,
    allowCheckCompensation: true,
  });
  return {
    ...paymentResult,
    installments: paymentResult.installments.map((item) =>
      item.id === installmentId
        ? {
            ...item,
            checkStatus: nextStatus,
            checkStatusHistory: statusHistory,
          }
        : item
    ),
  };
}

export function summarizePayables(payables = [], today = new Date()) {
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const nextMonth = new Date(startOfToday);
  nextMonth.setDate(nextMonth.getDate() + 30);
  const active = payables.map((payable) => ({
    ...payable,
    balance: getPayableBalance(payable),
  }));
  const overdueItems = [];
  const upcomingItems = [];

  for (const payable of active) {
    for (const installment of payable.installments || []) {
      const open = Math.max(
        cents(installment.amount) - cents(installment.paidAmount),
        0
      );
      const dueDate = toDate(installment.dueDate);
      if (!open || !dueDate) continue;
      const entry = {
        payableId: payable.id,
        supplierId: payable.supplierId,
        supplierName: payable.supplierName || "Fornecedor não informado",
        description: payable.description || "Compra",
        amount: amountFromCents(open),
        dueDate,
        method: installment.method || "",
        identification: installment.identification || "",
      };
      if (dueDate < startOfToday) overdueItems.push(entry);
      else if (dueDate < nextMonth) upcomingItems.push(entry);
    }
  }

  overdueItems.sort((first, second) => first.dueDate - second.dueDate);
  upcomingItems.sort((first, second) => first.dueDate - second.dueDate);
  const overduePayableIds = new Set(overdueItems.map((item) => item.payableId));

  return {
    totalToPay: amountFromCents(
      active.reduce((sum, payable) => sum + cents(payable.balance), 0)
    ),
    totalPaid: amountFromCents(
      active.reduce((sum, payable) => sum + cents(payable.paidAmount), 0)
    ),
    overdueCount: overduePayableIds.size,
    overdueTotal: amountFromCents(
      overdueItems.reduce((sum, item) => sum + cents(item.amount), 0)
    ),
    upcomingCount: upcomingItems.length,
    upcomingTotal: amountFromCents(
      upcomingItems.reduce((sum, item) => sum + cents(item.amount), 0)
    ),
    overdueItems,
    upcomingItems,
    active,
  };
}

export function filterPayablesByTrip(payables = [], tripFilter = "all") {
  if (tripFilter === "all") return payables;
  if (tripFilter === "unassigned") {
    return payables.filter((payable) => !payable.tripNumber);
  }
  const selected = tripFilter === "third" ? 3 : tripFilter === "fourth" ? 4 : Number(tripFilter);
  return payables.filter(
    (payable) => Number(payable.tripNumber) === selected
  );
}
