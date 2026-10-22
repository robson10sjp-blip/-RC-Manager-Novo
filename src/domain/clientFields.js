const onlyDigits = (value) => String(value ?? "").replace(/\D/g, "");

const nameParticles = new Set(["da", "das", "de", "do", "dos", "e"]);

export function normalizePersonName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((part, index) => {
      const normalized = part.toLocaleLowerCase("pt-BR");
      if (index > 0 && nameParticles.has(normalized)) return normalized;
      return normalized.replace(
        /(^|[-'’])(\p{L})/gu,
        (_, separator, letter) => `${separator}${letter.toLocaleUpperCase("pt-BR")}`
      );
    })
    .join(" ");
}

export function formatCpf(value) {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function isValidCpf(value) {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const length of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += Number(d[i]) * (length + 1 - i);
    const check = ((sum * 10) % 11) % 10;
    if (check !== Number(d[length])) return false;
  }
  return true;
}

export function formatPhone(value) {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// Só formata para exibição quando o tamanho é o padrão brasileiro; caso contrário preserva o valor salvo.
export function displayCpf(value) {
  return onlyDigits(value).length === 11 ? formatCpf(value) : String(value ?? "");
}

export function displayPhone(value) {
  const length = onlyDigits(value).length;
  return length === 10 || length === 11 ? formatPhone(value) : String(value ?? "");
}

export function isValidPhone(value) {
  const length = onlyDigits(value).length;
  return length === 0 || length === 10 || length === 11;
}
