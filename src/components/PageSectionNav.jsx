import "./PageSectionNav.css";

export default function PageSectionNav({ navigation, items, label, onSelect }) {
  const { active, select, navRef } = navigation;
  return <><span ref={navRef} aria-hidden="true" />
  <nav className="page-section-nav" aria-label={`Seções de ${label}`}>
    {items.map(({ id, label: title }) => <button key={id} type="button"
      aria-pressed={active === id}
      className={active === id ? "is-selected" : ""}
      onClick={() => onSelect ? onSelect(id) : select(id)}>
      {title}
    </button>)}
  </nav></>;
}
