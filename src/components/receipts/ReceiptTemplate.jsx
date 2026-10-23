import { forwardRef } from 'react';
import { getRecordTripId, getTripOptionLabel } from '../../domain/tripIdentity.js';
import './ReceiptTemplate.css';

const SINGLE_PAGE_ROWS = 9;
const FIRST_PAGE_ROWS = 15;
const NEXT_PAGE_ROWS = 22;
const LAST_PAGE_ROWS = 11;

// Divide os produtos em páginas A5; o fechamento (totais e assinatura) vai sempre na última.
function paginateRows(rows) {
  if (rows.length <= SINGLE_PAGE_ROWS) {
    return [{ rows, closing: true }];
  }

  const rest = [...rows];
  const pages = [{ rows: rest.splice(0, FIRST_PAGE_ROWS), closing: false }];

  while (rest.length > LAST_PAGE_ROWS) {
    pages.push({ rows: rest.splice(0, NEXT_PAGE_ROWS), closing: false });
  }

  pages.push({ rows: rest, closing: true });
  return pages;
}

const formatCurrency = (value) => {
  const number = Number(value || 0);

  return number.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
};

const formatDate = (value, includeTime = false) => {
  if (!value) return 'Não informada';

  let date;

  if (value?.toDate) {
    date = value.toDate();
  } else if (value?.seconds) {
    date = new Date(value.seconds * 1000);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(includeTime
      ? {
          hour: '2-digit',
          minute: '2-digit',
        }
      : {}),
  });
};

const getStatus = (total, received, originalStatus) => {
  if (originalStatus) {
    const normalizedStatus = String(originalStatus).toLowerCase();

    if (normalizedStatus === 'pago' || normalizedStatus === 'paid') {
      return 'PAGO';
    }

    if (
      normalizedStatus === 'parcial' ||
      normalizedStatus === 'partial'
    ) {
      return 'PARCIAL';
    }

    if (
      normalizedStatus === 'pendente' ||
      normalizedStatus === 'pending'
    ) {
      return 'PENDENTE';
    }
  }

  if (received >= total && total > 0) return 'PAGO';
  if (received > 0 && received < total) return 'PARCIAL';

  return 'PENDENTE';
};

const getPaymentMethod = (method) => {
  const methods = {
    cash: 'Dinheiro',
    dinheiro: 'Dinheiro',
    pix: 'Pix',
    card: 'Cartão',
    cartão: 'Cartão',
    cartao: 'Cartão',
    credit: 'Cartão de crédito',
    debit: 'Cartão de débito',
    prazo: 'A prazo',
    'a prazo': 'A prazo',
    vista: 'À vista',
    'à vista': 'À vista',
  };

  if (!method) return 'A definir';

  return methods[String(method).toLowerCase()] || method;
};

const ReceiptTemplate = forwardRef(function ReceiptTemplate(
  {
    sale = {},
    tripOptions = [],
    receiptNumber,
    companyName = 'RC Confecções',
  },
  ref
) {
  const items =
    sale.items ||
    sale.products ||
    sale.saleItems ||
    sale.produtos ||
    [];

  const clientName =
    sale.clientName ||
    sale.customerName ||
    sale.clienteNome ||
    sale.client?.name ||
    sale.customer?.name ||
    sale.cliente?.nome ||
    'Cliente não informado';

  const dueDate =
    sale.dueDate ||
    sale.paymentDueDate ||
    sale.collectionDate ||
    sale.dataCobranca ||
    sale.dataVencimento;

  const paymentMethod =
    sale.paymentMethod ||
    sale.method ||
    sale.formaPagamento ||
    sale.paymentType;

  const calculatedTotal = items.reduce((sum, item) => {
    const quantity = Number(
      item.quantity || item.qty || item.quantidade || 1
    );

    const price = Number(
      item.price ||
        item.unitPrice ||
        item.salePrice ||
        item.preco ||
        item.valor ||
        0
    );

    return sum + quantity * price;
  }, 0);

  const total = Number(
    sale.total ||
      sale.totalValue ||
      sale.amount ||
      sale.valorTotal ||
      calculatedTotal
  );

  const received = Number(
    sale.amountPaid ||
      sale.received ||
      sale.paidAmount ||
      sale.valorRecebido ||
      0
  );

  const pending = Math.max(total - received, 0);

  const status = getStatus(
    total,
    received,
    sale.status || sale.situacao
  );

const savedNumber =
  receiptNumber ||
  sale.receiptNumber ||
  sale.number ||
  sale.numeroRecibo ||
  sale.id;

const number = String(savedNumber || "")
  .replace(/[^a-z\d]/gi, "")
  .slice(-6);

  const rows = items.map((item, index) => {
    const quantity = Number(item.quantity || item.qty || item.quantidade || 1);

    const unitPrice = Number(
      item.price ||
        item.unitPrice ||
        item.salePrice ||
        item.preco ||
        item.valor ||
        0
    );

    const subtotal = Number(
      item.subtotal || item.total || item.valorTotal || quantity * unitPrice
    );

    const name =
      item.name ||
      item.productName ||
      item.description ||
      item.nome ||
      item.produto ||
      'Produto';

    return { key: item.id || `${name}-${index}`, quantity, unitPrice, subtotal, name };
  });

  const pages = paginateRows(rows);
  const receiptCode = /^\d+$/.test(number)
    ? number.padStart(6, '0')
    : number.toUpperCase() || 'Não informado';
  const tripLabel = [getRecordTripId(sale) ? getTripOptionLabel(sale, tripOptions) : '', sale.tripCity].filter(Boolean).join(' • ');

  return (
    <div className="rcp-wrapper">
      <div ref={ref} id="rc-receipt-template" className="rcp-doc">
        {pages.map((page, pageIndex) => (
          <div className="rcp-page" key={pageIndex} data-rcp-page={pageIndex}>
            <div className="rcp-watermark" aria-hidden="true">
              <span>R</span>
              <span>C</span>
            </div>

            <div className="rcp-content">
              {pageIndex === 0 ? (
                <>
                  <header className="rcp-header">
                    <div className="rcp-brand">
                      <div className="rcp-logo" aria-label="RC Confecções">
                        <span>R</span>
                        <span>C</span>
                      </div>

                      <div className="rcp-brand-text">
                        <strong>{companyName}</strong>
                        <em>PREMIUM</em>
                      </div>
                    </div>

                    <div className="rcp-receipt-id">
                      <span>RECIBO</span>
                      <strong>Nº {receiptCode}</strong>
                    </div>

                    <p className="rcp-slogan">Qualidade você encontra aqui</p>
                  </header>

                  <div className="rcp-info">
                    <div className="rcp-info-cell rcp-info-wide">
                      <span>Cliente</span>
                      <strong>{clientName}</strong>
                    </div>

                    <div className="rcp-info-cell">
                      <span>Cobrança prevista</span>
                      <strong>{dueDate ? formatDate(dueDate) : 'Não informada'}</strong>
                    </div>

                    <div className="rcp-info-cell">
                      <span>Pagamento</span>
                      <strong>{getPaymentMethod(paymentMethod)}</strong>
                    </div>

                    {tripLabel && (
                      <div className="rcp-info-cell">
                        <span>Viagem / cidade</span>
                        <strong>{tripLabel}</strong>
                      </div>
                    )}

                    <div className="rcp-info-cell">
                      <span>Situação</span>
                      <strong className={`rcp-status rcp-status-${status.toLowerCase()}`}>
                        {status}
                      </strong>
                    </div>
                  </div>
                </>
              ) : (
                <header className="rcp-header rcp-header-small">
                  <strong>{companyName} <em>PREMIUM</em></strong>
                  <span>Recibo Nº {receiptCode}</span>
                </header>
              )}

              {(page.rows.length > 0 || (pageIndex === 0 && rows.length === 0)) && (
                <table className="rcp-table">
                  <thead>
                    <tr>
                      <th>Descrição</th>
                      <th>Qtd.</th>
                      <th>Preço</th>
                      <th>Subtotal</th>
                    </tr>
                  </thead>

                  <tbody>
                    {page.rows.length > 0 ? (
                      page.rows.map((row) => (
                        <tr key={row.key}>
                          <td>{row.name}</td>
                          <td>{row.quantity}</td>
                          <td>{formatCurrency(row.unitPrice)}</td>
                          <td>{formatCurrency(row.subtotal)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td>Nenhum produto informado</td>
                        <td>—</td>
                        <td>{formatCurrency(0)}</td>
                        <td>{formatCurrency(0)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}

              {page.closing && (
                <>
                  <div className="rcp-totals">
                    <div className="rcp-total-box">
                      <span>Total da compra</span>
                      <strong>{formatCurrency(total)}</strong>
                    </div>

                    <div className="rcp-total-box">
                      <span>Valor recebido</span>
                      <strong>{formatCurrency(received)}</strong>
                    </div>

                    <div className="rcp-total-box rcp-total-pending">
                      <span>Saldo pendente</span>
                      <strong>{formatCurrency(pending)}</strong>
                    </div>
                  </div>

                  <p className="rcp-thanks">
                    Agradecemos pela preferência e que Deus te abençoe.
                  </p>

                  <div className="rcp-signature-area">
                    <div className="rcp-signature">Robson Henrique</div>
                    <div className="rcp-signature-line" />
                    <span>Robson Henrique Pereira Fernandes · {companyName}</span>
                  </div>
                </>
              )}
            </div>

            <div className="rcp-footer-bar" aria-hidden="true" />

            {pages.length > 1 && (
              <div className="rcp-page-number">
                Página {pageIndex + 1} de {pages.length}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

export default ReceiptTemplate;
