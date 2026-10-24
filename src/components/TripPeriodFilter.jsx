import "./TripPeriodFilter.css";

export default function TripPeriodFilter({ scope, label = "Período" }) {
  return (
    <div className="trip-period-filter" role="group" aria-label={label}>
      <label>
        Ano
        <select aria-label={`Ano · ${label}`} value={scope.selection === "all" ? "all" : scope.year}
          onChange={(event) => event.target.value === "all"
            ? scope.setSelection("all") : scope.setYear(Number(event.target.value))}>
          <option value="all">Todos os anos</option>
          {scope.years.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </label>
      <label>
        Viagem
        <select aria-label={`Viagem · ${label}`} value={scope.selection} onChange={(event) => scope.setSelection(event.target.value)}>
          <option value="all">Geral · todos os anos</option>
          <option value={`year-${scope.year}`}>Todas as viagens de {scope.year}</option>
          {scope.options.map((trip) => <option key={trip.id} value={trip.id}>{trip.name}</option>)}
        </select>
      </label>
    </div>
  );
}
