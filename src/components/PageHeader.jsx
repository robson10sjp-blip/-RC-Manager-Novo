import "./PageHeader.css";

export default function PageHeader({ icon: Icon, title, description, children }) {
  return (
    <header className="rc-ph">
      <div className="rc-ph-title-row">
        {Icon ? <Icon className="rc-ph-icon" aria-hidden="true" /> : null}
        <h1 className="rc-ph-title">{title}</h1>
      </div>
      <span className="rc-ph-rule" aria-hidden="true" />
      {description ? <p className="rc-ph-description">{description}</p> : null}
      {children ? <div className="rc-ph-actions">{children}</div> : null}
    </header>
  );
}
