import { useState } from "react";
import { formatBrlAmount, parseBrlAmount } from "../utils/currency.js";

export default function CurrencyInput({ value, onChange, onBlur, ...props }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const displayValue = focused
    ? draft
    : formatBrlAmount(value) || String(value ?? "");

  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onFocus={(event) => {
        setDraft(formatBrlAmount(value) || String(value ?? ""));
        setFocused(true);
        props.onFocus?.(event);
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        onChange(event.target.value);
      }}
      onBlur={(event) => {
        const amount = parseBrlAmount(event.target.value);
        if (Number.isFinite(amount)) {
          setDraft(String(amount));
          onChange(String(amount));
        }
        setFocused(false);
        onBlur?.(event);
      }}
    />
  );
}
