import { useEffect, useState } from "react";
import { FinancialPrivacyContext } from "./financialPrivacy.js";

const STORAGE_KEY = "rc-manager-financial-values-hidden";

export default function FinancialPrivacyProvider({ children }) {
  const [hidden, setHidden] = useState(
    () => localStorage.getItem(STORAGE_KEY) !== "false"
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(hidden));
  }, [hidden]);

  return (
    <FinancialPrivacyContext.Provider value={{ hidden, setHidden }}>
      {children}
    </FinancialPrivacyContext.Provider>
  );
}
