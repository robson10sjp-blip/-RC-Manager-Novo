const PRODUCT_ACRONYMS = new Set(["TXC", "GG"]);

export function formatProductName(value) {
  return String(value ?? "").replace(/\p{L}[\p{L}\p{M}\d]*/gu, (word) => {
    const upperWord = word.toLocaleUpperCase("pt-BR");
    if (PRODUCT_ACRONYMS.has(upperWord)) return upperWord;

    const [firstLetter, ...remainingLetters] = Array.from(
      word.toLocaleLowerCase("pt-BR")
    );
    return `${firstLetter.toLocaleUpperCase("pt-BR")}${remainingLetters.join("")}`;
  });
}
