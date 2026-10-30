function amount(item) {
  return Math.round(Number(item.quantity || 0) *
    Number(item.price ?? item.unitPrice ?? 0) * 100) / 100;
}

export function validateSalePeople(sale) {
  const people = sale.people || [];
  if (!people.length) return;
  const ids = new Set(people.map((person) => person.id));
  if (ids.size !== people.length || people.some((person) =>
    !person.id || typeof person.name !== "string" || !person.name.trim())) {
    throw new Error("Informe o nome de cada pessoa da compra.");
  }
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
