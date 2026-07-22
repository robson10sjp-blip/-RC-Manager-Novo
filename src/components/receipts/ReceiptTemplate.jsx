import { forwardRef } from 'react';
import './ReceiptTemplate.css';

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
    receiptNumber,
    companyName = 'RC Confecções',
    sellerName = 'Robson Henrique',
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

  const saleDate =
    sale.saleDate ||
    sale.createdAt ||
    sale.date ||
    sale.dataVenda ||
    new Date();

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
  sale.numeroRecibo;

const number = savedNumber
  ? String(savedNumber).replace(/\D/g, "").slice(-6)
  : String(Date.now()).slice(-6);

  return (
    <div className="rc-receipt-wrapper">
      <article
        ref={ref}
        id="rc-receipt-template"
        className="rc-receipt"
      >
        <div className="rc-receipt-watermark" aria-hidden="true">
          <span className="rc-watermark-r">R</span>
          <span className="rc-watermark-c">C</span>
        </div>

        <header className="rc-receipt-header">
          <section className="rc-brand-area">
            <div className="rc-logo-box" aria-label="RC Confecções">
              <span className="rc-logo-r">R</span>
              <span className="rc-logo-c">C</span>
            </div>

            <div className="rc-brand-divider" />

            <div className="rc-brand-text">
              <h1>
                <span>RC</span> <strong>CONFECÇÕES</strong>
              </h1>

              <p>
                <i />
                QUALIDADE VOCÊ ENCONTRA AQUI
                <i />
              </p>
            </div>
          </section>

          <section className="rc-receipt-title">
            <h2>RECIBO DE VENDA</h2>
            <div className="rc-title-line" />

            <p>
              Nº <strong>{String(number).padStart(6, '0')}</strong>
            </p>
          </section>
        </header>

        <section className="rc-receipt-information">
          <div className="rc-customer-information">
            <div className="rc-information-row">
              <div className="rc-information-icon">●</div>

              <div className="rc-information-content">
                <strong>CLIENTE:</strong>
                <span>{clientName}</span>
              </div>
            </div>

            <div className="rc-information-row">
              <div className="rc-information-icon">▣</div>

              <div className="rc-information-content">
                <strong>DATA DA VENDA:</strong>
                <span>{formatDate(saleDate, true)}</span>
              </div>
            </div>

            <div className="rc-information-row">
              <div className="rc-information-icon">▣</div>

              <div className="rc-information-content">
                <strong>DATA PREVISTA PARA COBRANÇA:</strong>

                <span>
                  {dueDate ? formatDate(dueDate) : 'Não informada'}
                </span>
              </div>
            </div>

            <div className="rc-information-row">
              <div className="rc-information-icon">▰</div>

              <div className="rc-information-content">
                <strong>FORMA DE PAGAMENTO:</strong>
                <span>{getPaymentMethod(paymentMethod)}</span>
              </div>
            </div>
          </div>

          <div className="rc-sale-information">
            <div className="rc-sale-information-row">
              <div className="rc-black-icon">$</div>

              <strong>SITUAÇÃO:</strong>

              <span
                className={`rc-status rc-status-${status.toLowerCase()}`}
              >
                {status}
              </span>
            </div>

            <div className="rc-sale-information-row">
              <div className="rc-black-icon">▣</div>

              <strong>VENDEDOR:</strong>
              <span>{sellerName}</span>
            </div>

            <div className="rc-sale-information-row">
              <div className="rc-black-icon">▤</div>

              <strong>EMPRESA:</strong>
              <span>{companyName}</span>
            </div>
          </div>
        </section>

        <section className="rc-products-section">
          <table className="rc-products-table">
            <thead>
              <tr>
                <th>QTD.</th>
                <th>PRODUTO</th>
                <th>VALOR UNITÁRIO</th>
                <th>SUBTOTAL</th>
              </tr>
            </thead>

            <tbody>
              {items.length > 0 ? (
                items.map((item, index) => {
                  const quantity = Number(
                    item.quantity || item.qty || item.quantidade || 1
                  );

                  const unitPrice = Number(
                    item.price ||
                      item.unitPrice ||
                      item.salePrice ||
                      item.preco ||
                      item.valor ||
                      0
                  );

                  const subtotal = Number(
                    item.subtotal ||
                      item.total ||
                      item.valorTotal ||
                      quantity * unitPrice
                  );

                  const productName =
                    item.name ||
                    item.productName ||
                    item.description ||
                    item.nome ||
                    item.produto ||
                    'Produto';

                  return (
                    <tr key={item.id || `${productName}-${index}`}>
                      <td>{quantity}x</td>
                      <td>{productName}</td>
                      <td>{formatCurrency(unitPrice)}</td>
                      <td>{formatCurrency(subtotal)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td>—</td>
                  <td>Nenhum produto informado</td>
                  <td>{formatCurrency(0)}</td>
                  <td>{formatCurrency(0)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="rc-summary-section">
          <div className="rc-observations">
            <div className="rc-observations-title">
              <div className="rc-observations-icon">☰</div>
              <strong>OBSERVAÇÕES</strong>
            </div>

            <p>
              Agradecemos pela preferência
              <br />e que Deus te abençoe!
            </p>
          </div>

          <div className="rc-payment-summary">
            <div className="rc-summary-line">
              <strong>TOTAL DOS PRODUTOS:</strong>
              <span>{formatCurrency(total)}</span>
            </div>

            <div className="rc-summary-line">
              <strong>VALOR RECEBIDO:</strong>
              <span>{formatCurrency(received)}</span>
            </div>

            <div className="rc-pending-balance">
              <strong>SALDO PENDENTE:</strong>
              <span>{formatCurrency(pending)}</span>
            </div>
          </div>
        </section>

        <footer className="rc-receipt-footer">
          <div className="rc-signature-area">
            <div className="rc-signature-watermark" aria-hidden="true">
              <span>R</span>
              <strong>C</strong>
            </div>

            <div className="rc-signature">Robson Henrique</div>

            <div className="rc-signature-line" />

            <strong className="rc-full-name">
              Robson Henrique Pereira Fernandes
            </strong>

            <span className="rc-company-name">{companyName}</span>
          </div>

          <div className="rc-footer-message">
            <i />
            <span>♡</span>

            <div>
              <p>OBRIGADO PELA PREFERÊNCIA!</p>
              <strong>QUE DEUS TE ABENÇOE!</strong>
            </div>

            <span>♡</span>
            <i />
          </div>
        </footer>

        <div className="rc-bottom-decoration">
          <div className="rc-bottom-gold-line" />
          <div className="rc-bottom-black-shape" />
        </div>
      </article>
    </div>
  );
});

export default ReceiptTemplate;