import { createContext, useContext } from "react";

export const FinancialPrivacyContext = createContext(null);

export function useFinancialPrivacy() {
  const context = useContext(FinancialPrivacyContext);
  if (!context) {
    throw new Error(
      "useFinancialPrivacy deve ser usado dentro de FinancialPrivacyProvider."
    );
  }
  return context;
}

export function maskFinancialText(value, hidden) {
  return hidden
    ? String(value).replace(/R\$\s*[-\d.]+,\d{2}/gu, "••••••")
    : value;
}
