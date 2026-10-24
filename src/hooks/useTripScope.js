import { useCallback, useMemo, useState } from "react";
import {
  buildPeriodOptions, changeTripScopeYear, getTripScopeLabel,
  normalizeTripScopeSelection,
} from "../domain/tripIdentity.js";
import { saleDateInput } from "../domain/saleTrip.js";

// Only view filters survive route changes; no records or credentials are stored here.
const views = new Map();

export function useViewState(key, initial) {
  const [value, setValue] = useState(() => views.has(key) ? views.get(key) : initial);
  const update = useCallback((next) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      views.set(key, resolved);
      return resolved;
    });
  }, [key]);
  return [value, update];
}

export default function useTripScope(key, references = []) {
  const currentYear = Number(saleDateInput(new Date()).slice(0, 4));
  const [scope, setScope] = useViewState(`${key}:period`, { year: currentYear, selection: "all" });
  const selection = normalizeTripScopeSelection(scope.selection);
  const period = selection.match(/^trip-(\d{4})-[1-4]$/);
  const year = period ? Number(period[1]) : scope.year;
  const options = useMemo(() => buildPeriodOptions(references, year), [references, year]);
  const filterOptions = useMemo(() => [...options, ...references], [options, references]);
  const years = [...new Set([currentYear - 1, currentYear, currentYear + 1, year, ...references.map((trip) => trip.tripYear).filter(Boolean)])]
    .sort((a, b) => b - a);
  return {
    year, selection, options, years,
    label: getTripScopeLabel(selection, year),
    setSelection: (nextSelection) => setScope((current) => ({
      ...current, selection: normalizeTripScopeSelection(nextSelection),
    })),
    setYear: (year) => setScope((current) => ({
      year, selection: changeTripScopeYear(current.selection, year),
    })),
    filterOptions,
  };
}
