function amount(item) {
  if (hasSubtotal(item)) return Number(item.subtotal);
  return Math.round(Number(item.quantity || 0) *
    Number(item.price ?? item.unitPrice ?? 0) * 100) / 100;
}

function hasSubtotal(item) {
  return item.subtotal !== undefined && item.subtotal !== null && item.subtotal !== "" &&
    Number.isFinite(Number(item.subtotal));
}

export function saleItemLabel(item = {}) {
  const name = item.name || item.productName || "Produto";
  const size = item.size && !/\s[—-]\s*Tam\.\s/i.test(name) ? ` — Tam. ${item.size}` : "";
  const color = item.color && !name.endsWith(` · ${item.color}`) ? ` · ${item.color}` : "";
  return `${name}${size}${color}`;
}

export function splitPersonItem(item, quantity, personId) {
  const total = Number(item.quantity);
  const moved = Number(quantity);
  if (!Number.isInteger(moved) || moved <= 0 || !Number.isInteger(total) || moved > total) {
    throw new Error("Informe uma quantidade inteira entre 1 e a quantidade da peça.");
  }
  if (moved === total) return [{ ...item, personId }];
  const movedSubtotal = Math.round(amount(item) * 100 * moved / total) / 100;
  return [
    { ...item, quantity: total - moved, ...(hasSubtotal(item)
      ? { subtotal: Math.round((Number(item.subtotal) - movedSubtotal) * 100) / 100 } : {}) },
    { ...item, quantity: moved, personId, ...(hasSubtotal(item) ? { subtotal: movedSubtotal } : {}) },
  ];
}

export function assignSaleItems(sale, selections, personId) {
  if (!sale.people?.some((person) => person.id === personId)) {
    throw new Error("Escolha a pessoa que receberá as peças.");
  }
  if (!Object.keys(selections).length) throw new Error("Selecione pelo menos uma peça.");
  for (const index of Object.keys(selections)) {
    if (!sale.items[index]?.productId) throw new Error("Selecione uma peça válida.");
  }
  return { ...sale, items: sale.items.flatMap((item, index) => {
    if (!Object.hasOwn(selections, index)) return [item];
    const split = splitPersonItem(item, selections[index], personId);
    return item.personId === personId ? [item] : split;
  }) };
}

// Each split retains its source only in the form. Persist historical fields, never form metadata.
export function buildAllocationItems(storedItems = [], formItems = []) {
  const partitions = storedItems.map(() => []);
  for (const item of formItems) {
    const source = storedItems[item.sourceIndex];
    if (!source || item.productId !== (source.productId || "") ||
      Number(item.price) !== Number(source.unitPrice ?? source.price ?? 0) ||
      !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) return null;
    partitions[item.sourceIndex].push(item);
  }
  if (partitions.some((parts, index) => !parts.length ||
    parts.reduce((sum, item) => sum + Number(item.quantity), 0) !== Number(storedItems[index].quantity ?? 1))) return null;
  const allocated = new Map();
  for (const [index, parts] of partitions.entries()) {
    const source = storedItems[index];
    const keepSubtotals = hasSubtotal(source) && parts.every(hasSubtotal) &&
      parts.reduce((sum, item) => sum + Math.round(Number(item.subtotal) * 100), 0) === Math.round(Number(source.subtotal) * 100);
    let remaining = source;
    for (const [partIndex, part] of parts.entries()) {
      const split = partIndex === parts.length - 1
        ? [{ ...remaining, personId: part.personId }]
        : splitPersonItem(remaining, part.quantity, part.personId);
      allocated.set(part, { ...split.at(-1), ...(keepSubtotals ? { subtotal: part.subtotal } : {}) });
      remaining = split[0];
    }
  }
  return formItems.map((item) => {
    const saved = { ...allocated.get(item) };
    if (!saved.personId) delete saved.personId;
    return saved;
  });
}

export function validateSalePeople(sale) {
  const people = sale.people || [];
  if (!people.length) return;
  const ids = new Set(people.map((person) => person.id));
  if (ids.size !== people.length || people.some((person) =>
    !person.id || typeof person.name !== "string" || !person.name.trim())) {
    throw new Error("Informe o nome de cada pessoa da compra.");
  }
  const names = people.map((person) => person.name.trim().toLocaleLowerCase("pt-BR"));
  if (new Set(names).size !== names.length) throw new Error("Esta pessoa já está cadastrada. Selecione o nome existente.");
  if ((sale.items || []).some((item) => !ids.has(item.personId))) {
    throw new Error("Escolha a pessoa de cada item antes de salvar.");
  }
}

export function groupSalePeople(sale) {
  if (!sale.people?.length) return [];
  const groups = sale.people.map((person) => ({
    ...person, items: (sale.items || []).filter((item) => item.personId === person.id),
  }));
  const unassigned = (sale.items || []).filter((item) =>
    !sale.people.some((person) => person.id === item.personId));
  if (unassigned.length) groups.push({ id: "unassigned", name: "Sem pessoa informada", items: unassigned });
  return groups.map((group) => ({
    ...group, subtotal: Math.round(group.items.reduce((sum, item) => sum + amount(item), 0) * 100) / 100,
  }));
}

export function removeSalePerson(sale, personId, replacementId) {
  const assigned = sale.items.some((item) => item.personId === personId);
  if (assigned && (!replacementId || replacementId === personId ||
    !sale.people.some((person) => person.id === replacementId))) {
    throw new Error("Escolha para quem transferir os itens antes de remover a pessoa.");
  }
  return {
    ...sale,
    people: sale.people.filter((person) => person.id !== personId),
    items: sale.items.map((item) => item.personId === personId ? { ...item, personId: replacementId } : item),
  };
}

export function salePeopleFields(sale) {
  validateSalePeople(sale);
  return sale.people?.length
    ? { people: sale.people.map(({ id, name, relationship }) => ({ id, name: name.trim(), relationship: (relationship || "").trim() })) }
    : {};
}

export function itemPersonFields(item, sale) {
  return sale.people?.length ? { personId: item.personId } : {};
}

export function buildPersonReceiptRows(rows, sale) {
  if (!sale.people?.length) return rows;
  return groupSalePeople(sale).filter((person) => person.items.length).flatMap((person) => [
    { key: `person-${person.id}`, type: "person", name: person.name, relationship: person.relationship },
    ...rows.filter((row) => row.personId === person.id ||
      (person.id === "unassigned" && !sale.people.some((entry) => entry.id === row.personId))),
    { key: `subtotal-${person.id}`, type: "subtotal", name: person.name, subtotal: person.subtotal },
  ]);
}
