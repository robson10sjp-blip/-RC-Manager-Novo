import { useFinancialPrivacy } from "../context/financialPrivacy.js";

export default function FinancialValue({ children }) {
  const { hidden } = useFinancialPrivacy();
  return hidden ? (
    <span aria-label="Valor financeiro oculto">••••••</span>
  ) : (
    children
  );
}
