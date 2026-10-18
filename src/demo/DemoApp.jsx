import { useMemo, useState } from "react";

const initialClients = [
  { id: "cli-ana", name: "Ana Martins", city: "Campinas", phone: "(19) 98888-1020", legacy: 240 },
  { id: "cli-bruno", name: "Bruno Costa", city: "Santos", phone: "(13) 97777-2040", legacy: 0 },
  { id: "cli-carla", name: "Carla Souza", city: "Campinas", phone: "(19) 96666-3090", legacy: 180 },
];

const initialSales = [
  {
    id: "RC-2026-0101",
    clientId: "cli-ana",
    clientName: "Ana Martins",
    date: "14/10/2026",
    due: "13/01/2027",
    trip: "Outubro 2026",
    city: "Campinas",
    total: 460,
    received: 160,
    pending: 300,
    status: "Parcial",
    items: "2 vestidos • 1 camisa",
  },
  {
    id: "RC-2026-0102",
    clientId: "cli-ana",
    clientName: "Ana Martins",
    date: "16/10/2026",
    due: "14/01/2027",
    trip: "Outubro 2026",
    city: "Campinas",
    total: 275,
    received: 0,
    pending: 275,
    status: "Pendente",
    items: "1 conjunto • 1 blusa",
  },
  {
    id: "RC-2026-0103",
    clientId: "cli-bruno",
    clientName: "Bruno Costa",
    date: "15/10/2026",
    due: "14/01/2027",
    trip: "Litoral — outubro",
    city: "Santos",
    total: 320,
    received: 320,
    pending: 0,
    status: "Pago",
    items: "2 camisetas • 1 bermuda",
  },
  {
    id: "RC-2026-0104",
    clientId: "cli-carla",
    clientName: "Carla Souza",
    date: "16/10/2026",
    due: "14/01/2027",
    trip: "Outubro 2026",
    city: "Campinas",
    total: 185,
    received: 50,
    pending: 135,
    status: "Parcial",
    items: "1 vestido",
  },
];

const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

const navItems = [
  { id: "inicio", icon: "◫", label: "Visão geral" },
  { id: "clientes", icon: "♙", label: "Clientes" },
  { id: "vendas", icon: "▤", label: "Vendas" },
  { id: "financeiro", icon: "↗", label: "Financeiro" },
];

function AppHeader({ active, onNavigate }) {
  return (
    <>
      <aside className="demo-sidebar">
        <div className="demo-brand">
          <span className="demo-brand-mark">RC</span>
          <span>
            <strong>RC Manager</strong>
            <small>RC Confecções</small>
          </span>
        </div>
        <nav className="demo-nav" aria-label="Navegação da demonstração">
          {navItems.map((item) => (
            <button
              className={`demo-nav-link ${active === item.id ? "is-active" : ""}`}
              key={item.id}
              onClick={() => onNavigate(item.id)}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="demo-sidebar-note">Ambiente de demonstração<br />Dados fictícios • somente neste navegador</div>
      </aside>
      <header className="demo-mobile-header">
        <span className="demo-brand-mark">RC</span>
        <strong>RC Manager</strong>
        <span className="demo-demo-pill">DEMO</span>
      </header>
    </>
  );
}

function Metric({ label, value, detail, tone = "blue" }) {
  return (
    <article className="demo-metric">
      <span className={`demo-metric-icon tone-${tone}`}>{label.slice(0, 1)}</span>
      <span className="demo-metric-label">{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}

function Status({ status }) {
  return <span className={`demo-status status-${status.toLowerCase()}`}>{status}</span>;
}

function PurchaseCard({ sale, onReceipt, onReceive }) {
  return (
    <article className="demo-purchase">
      <div className="demo-purchase-top">
        <div>
          <span className="demo-purchase-id">COMPRA {sale.id}</span>
          <h3>{sale.clientName}</h3>
          <p>{sale.date} <span>•</span> Vencimento {sale.due}</p>
        </div>
        <Status status={sale.status} />
      </div>
      <p className="demo-items">{sale.items}</p>
      <div className="demo-purchase-values">
        <div><small>Total</small><strong>{money(sale.total)}</strong></div>
        <div><small>Recebido</small><strong className="text-green">{money(sale.received)}</strong></div>
        <div><small>Saldo desta compra</small><strong className="text-red">{money(sale.pending)}</strong></div>
      </div>
      <div className="demo-purchase-foot">
        <span>🧭 {sale.trip} <i>•</i> {sale.city}</span>
        <div className="demo-actions">
          {sale.pending > 0 && <button className="demo-button button-green" onClick={() => onReceive(sale.id)}>＋ Registrar recebimento</button>}
          <button className="demo-button button-light" onClick={() => onReceipt(sale)}>Ver recibo</button>
        </div>
      </div>
    </article>
  );
}

export default function DemoApp() {
  const [active, setActive] = useState("inicio");
  const [sales, setSales] = useState(initialSales);
  const [receipt, setReceipt] = useState(null);
  const [toast, setToast] = useState("");

  const summary = useMemo(
    () =>
      sales.reduce(
        (totals, sale) => ({
          sold: totals.sold + sale.total,
          received: totals.received + sale.received,
          pending: totals.pending + sale.pending,
        }),
        { sold: 0, received: 0, pending: 0 }
      ),
    [sales]
  );

  const trips = useMemo(() => {
    const grouped = new Map();
    for (const sale of sales) {
      const key = `${sale.trip}|${sale.city}`;
      const current = grouped.get(key) || { name: sale.trip, city: sale.city, count: 0, sold: 0, received: 0, pending: 0 };
      current.count += 1;
      current.sold += sale.total;
      current.received += sale.received;
      current.pending += sale.pending;
      grouped.set(key, current);
    }
    return [...grouped.values()].sort((a, b) => b.sold - a.sold);
  }, [sales]);

  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2500);
  }

  function receivePayment(saleId) {
    const sale = sales.find((item) => item.id === saleId);
    const amount = Math.min(50, sale.pending);
    setSales((current) =>
      current.map((item) =>
        item.id !== saleId
          ? item
          : {
              ...item,
              received: item.received + amount,
              pending: item.pending - amount,
              status: item.pending === amount ? "Pago" : "Parcial",
            }
      )
    );
    notify(`Recebimento fictício de ${money(amount)} aplicado somente em ${saleId}.`);
  }

  const pageTitles = {
    inicio: ["Visão geral", "Acompanhe os principais números do negócio."],
    clientes: ["Clientes", "Saldos históricos separados das compras registradas."],
    vendas: ["Vendas e compras", "Cada compra tem identificação, vencimento e saldo próprios."],
    financeiro: ["Financeiro", "Recebimentos, compras em aberto e resultados por viagem."],
  };

  return (
    <div className="demo-shell">
      <AppHeader active={active} onNavigate={setActive} />
      <main className="demo-main">
        <div className="demo-banner"><span>●</span><strong>PRÉVIA SEGURA</strong><span>Dados fictícios em memória. Esta demonstração não acessa o Firebase.</span></div>
        <header className="demo-page-header">
          <div><p>RC CONFECÇÕES <span> / </span> DEMONSTRAÇÃO</p><h1>{pageTitles[active][0]}</h1><span>{pageTitles[active][1]}</span></div>
          <div className="demo-user"><span>RH</span><div><strong>Robson Henrique</strong><small>Conta de demonstração</small></div></div>
        </header>

        {active === "inicio" && (
          <>
            <section className="demo-metrics">
              <Metric label="Vendido no período" value={money(summary.sold)} detail="4 compras de exemplo" />
              <Metric label="Total recebido" value={money(summary.received)} detail="Somente recebimentos das compras" tone="green" />
              <Metric label="Compras em aberto" value={money(summary.pending)} detail="3 saldos individuais" tone="red" />
              <Metric label="Viagens cadastradas" value={trips.length} detail="Agrupadas por viagem e cidade" tone="purple" />
            </section>
            <section className="demo-panel">
              <div className="demo-section-heading"><div><h2>Compras recentes</h2><p>A mesma cliente pode ter várias compras independentes.</p></div><button className="demo-link" onClick={() => setActive("vendas")}>Ver todas →</button></div>
              <div className="demo-purchase-list">{sales.slice(0, 2).map((sale) => <PurchaseCard key={sale.id} sale={sale} onReceipt={setReceipt} onReceive={receivePayment} />)}</div>
            </section>
          </>
        )}

        {active === "clientes" && (
          <section className="demo-panel">
            <div className="demo-section-heading"><div><h2>Clientes cadastrados</h2><p>O saldo legado é exibido à parte e não quita compras automaticamente.</p></div><span className="demo-count">{initialClients.length} clientes</span></div>
            <div className="demo-client-list">{initialClients.map((client) => {
              const purchases = sales.filter((sale) => sale.clientId === client.id);
              const purchaseBalance = purchases.reduce((sum, sale) => sum + sale.pending, 0);
              return <article className="demo-client" key={client.id}>
                <div className="demo-avatar">{client.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div>
                <div className="demo-client-info"><h3>{client.name}</h3><p>{client.phone} <span>•</span> {client.city}</p><small>{purchases.length} compra(s) registrada(s)</small></div>
                <div className="demo-client-balances"><div><small>Saldo legado (não conciliado)</small><strong>{money(client.legacy)}</strong></div><div><small>Saldo em compras</small><strong className="text-red">{money(purchaseBalance)}</strong></div></div>
              </article>;
            })}</div>
            <div className="demo-callout"><strong>Importante</strong><span>O saldo legado de Ana e Carla é fictício e separado dos saldos das compras mostradas. A prévia não faz conciliação nem alteração de dados.</span></div>
          </section>
        )}

        {active === "vendas" && (
          <section className="demo-panel">
            <div className="demo-section-heading"><div><h2>Compras registradas</h2><p>Identificação de compra e recebimentos preservados por compra.</p></div><span className="demo-count">{sales.length} compras</span></div>
            <div className="demo-purchase-list">{sales.map((sale) => <PurchaseCard key={sale.id} sale={sale} onReceipt={setReceipt} onReceive={receivePayment} />)}</div>
          </section>
        )}

        {active === "financeiro" && (
          <>
            <section className="demo-metrics">
              <Metric label="Total vendido" value={money(summary.sold)} />
              <Metric label="Recebido" value={money(summary.received)} tone="green" />
              <Metric label="Pendente" value={money(summary.pending)} tone="red" />
              <Metric label="Compras" value={sales.length} detail="Identificadores individuais" tone="purple" />
            </section>
            <section className="demo-panel">
              <div className="demo-section-heading"><div><h2>Vendas por viagem</h2><p>Totais das compras associadas a cada viagem e cidade.</p></div></div>
              <div className="demo-trip-list">{trips.map((trip) => <article className="demo-trip" key={`${trip.name}-${trip.city}`}><div className="demo-trip-icon">⌖</div><div className="demo-trip-name"><strong>{trip.name}</strong><small>{trip.city} <span>•</span> {trip.count} compras</small></div><div className="demo-trip-totals"><span>Vendido <strong>{money(trip.sold)}</strong></span><span>Recebido <strong className="text-green">{money(trip.received)}</strong></span><span>Pendente <strong className="text-red">{money(trip.pending)}</strong></span></div></article>)}</div>
            </section>
            <section className="demo-panel">
              <div className="demo-section-heading"><div><h2>Recebimentos por compra</h2><p>Ao testar, o valor fictício é aplicado apenas à compra selecionada.</p></div></div>
              <div className="demo-purchase-list">{sales.filter((sale) => sale.pending > 0).map((sale) => <PurchaseCard key={sale.id} sale={sale} onReceipt={setReceipt} onReceive={receivePayment} />)}</div>
            </section>
          </>
        )}
        <footer className="demo-footer">RC Manager Novo <span>•</span> Prévia local isolada <span>•</span> Não conectada ao Firebase</footer>
      </main>
      <nav className="demo-mobile-nav" aria-label="Navegação móvel">
        {navItems.map((item) => <button key={item.id} className={active === item.id ? "is-active" : ""} onClick={() => setActive(item.id)}><span>{item.icon}</span>{item.label}</button>)}
      </nav>
      {receipt && <div className="demo-modal-backdrop" role="presentation" onClick={() => setReceipt(null)}><section className="demo-receipt" role="dialog" aria-modal="true" aria-label="Recibo de demonstração" onClick={(event) => event.stopPropagation()}><button className="demo-modal-close" onClick={() => setReceipt(null)} aria-label="Fechar recibo">×</button><div className="demo-receipt-brand">RC <span>CONFECÇÕES</span></div><small>RECIBO DE VENDA · COMPRA {receipt.id}</small><h2>{receipt.clientName}</h2><p>{receipt.date} · {receipt.trip} — {receipt.city}</p><hr /><div><span>Total</span><strong>{money(receipt.total)}</strong></div><div><span>Recebido</span><strong className="text-green">{money(receipt.received)}</strong></div><div><span>Saldo desta compra</span><strong className="text-red">{money(receipt.pending)}</strong></div><p className="demo-receipt-note">Documento demonstrativo — dados fictícios</p></section></div>}
      {toast && <div className="demo-toast" role="status">{toast}</div>}
    </div>
  );
}
