const onlyDigits = (value) => String(value || "").replace(/\D/g, "");

export function formatSupplierPhone(value) {
  const digits = onlyDigits(value).slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function formatSupplierDocument(value) {
  const digits = onlyDigits(value).slice(0, 14);
  if (digits.length <= 11) {
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
    if (digits.length <= 9) {
      return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
    }
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  }
  if (digits.length <= 12) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function getSupplierDisplayName(supplier) {
  return supplier.companyName || supplier.name || "Fornecedor não informado";
}

export function createSupplierIdentifier(documentId) {
  const suffix = String(documentId || "").replace(/[^a-z\d]/gi, "").slice(-8);
  if (!suffix) throw new Error("Não foi possível gerar o código do fornecedor.");
  return `FORN-${suffix.toUpperCase()}`;
}

export function buildSupplierPayable({
  supplier,
  description,
  purchaseDate,
  totalAmount,
  downPayment,
  installments,
  now = new Date(),
}) {
  const total = Number(String(totalAmount).replace(",", "."));
  const paid = Number(String(downPayment || 0).replace(",", "."));
  const totalCents = Math.round((total + Number.EPSILON) * 100);
  const paidCents = Math.round((paid + Number.EPSILON) * 100);

  if (!supplier?.id) throw new Error("Selecione um fornecedor cadastrado.");
  if (!String(description || "").trim()) {
    throw new Error("Informe a descrição da mercadoria.");
  }
  if (!Number.isFinite(totalCents) || totalCents <= 0) {
    throw new Error("Informe um valor total maior que zero.");
  }
  if (!Number.isFinite(paidCents) || paidCents < 0 || paidCents > totalCents) {
    throw new Error("O valor pago deve estar entre zero e o total da compra.");
  }
  if (!Array.isArray(installments)) {
    throw new Error("A lista de parcelas é inválida.");
  }

  const chequeNumbers = new Set();
  const normalizedInstallments = installments.map((installment, index) => {
    const amount = Number(String(installment.amount || 0).replace(",", "."));
    const amountCents = Math.round((amount + Number.EPSILON) * 100);
    const dueDate = installment.dueDate
      ? new Date(`${installment.dueDate}T12:00:00`)
      : null;
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      throw new Error(`Informe um valor válido para a parcela ${index + 1}.`);
    }
    if (!dueDate || Number.isNaN(dueDate.getTime())) {
      throw new Error(`Informe um vencimento válido para a parcela ${index + 1}.`);
    }
    const method = installment.method || "boleto";
    if (!["boleto", "cheque"].includes(method)) {
      throw new Error(`A forma da parcela ${index + 1} não é válida.`);
    }
    const checkFields = {};
    if (method === "cheque") {
      const identification = String(installment.identification || "").trim();
      const issueDate = installment.issueDate
        ? new Date(`${installment.issueDate}T12:00:00`)
        : null;
      if (!identification) throw new Error(`Informe o número do cheque da parcela ${index + 1}.`);
      if (!["bb-pf", "bb-pj"].includes(installment.bankAccount)) {
        throw new Error(`Selecione a conta do cheque da parcela ${index + 1}.`);
      }
      if (!issueDate || Number.isNaN(issueDate.getTime())) {
        throw new Error(`Informe a data de emissão do cheque da parcela ${index + 1}.`);
      }
      const uniqueNumber = `${installment.bankAccount}|${identification.toLocaleLowerCase("pt-BR")}`;
      if (chequeNumbers.has(uniqueNumber)) {
        throw new Error("Cada cheque deve ter número próprio dentro da conta bancária.");
      }
      chequeNumbers.add(uniqueNumber);
      checkFields.bankAccount = installment.bankAccount;
      checkFields.bankName = installment.bankName || "Banco do Brasil";
      checkFields.issueDate = issueDate;
      checkFields.checkStatus = "issued";
      checkFields.checkStatusHistory = [
        { status: "issued", changedAt: now },
      ];
    }
    return {
      id: installment.id || `installment-${index + 1}`,
      amount: amountCents / 100,
      paidAmount: 0,
      dueDate,
      method,
      identification: method === "cheque"
        ? String(installment.identification).trim()
        : String(installment.identification || "").trim(),
      ...checkFields,
      status: "pending",
    };
  });
  const installmentsCents = normalizedInstallments.reduce(
    (sum, installment) =>
      sum + Math.round((installment.amount + Number.EPSILON) * 100),
    0
  );
  if (installmentsCents !== totalCents - paidCents) {
    throw new Error(
      "A soma das parcelas deve corresponder exatamente ao saldo após o valor pago."
    );
  }

  const purchase = new Date(`${purchaseDate}T12:00:00`);
  if (!purchaseDate || Number.isNaN(purchase.getTime())) {
    throw new Error("Informe uma data válida para a compra.");
  }

  return {
    supplierId: supplier.id,
    supplierName: getSupplierDisplayName(supplier),
    purchaseType: "inventory",
    paymentType: paidCents === totalCents ? "cash" : "credit",
    description: String(description).trim(),
    purchaseDate: purchase,
    totalAmount: totalCents / 100,
    paidAmount: paidCents / 100,
    initialPaymentAmount: paidCents / 100,
    balance: (totalCents - paidCents) / 100,
    initialPaymentDate: paidCents > 0 ? now : null,
    installments: normalizedInstallments,
    status:
      totalCents === paidCents
        ? "paid"
        : paidCents > 0
          ? "partial"
          : "pending",
    createdAt: now,
    updatedAt: now,
  };
}
