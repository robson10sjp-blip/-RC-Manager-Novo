import { useEffect, useRef, useState } from "react";
import ReceiptTemplate from "./ReceiptTemplate";
import {
  buildReceiptPdfFile,
  canShareReceiptFile,
  downloadReceiptFile,
  printReceipt,
  shareReceiptFile,
} from "./generateReceiptPdf";
import "./ReceiptViewer.css";

export default function ReceiptViewer({ sale, onClose, tripOptions = [] }) {
  const receiptRef = useRef(null);
  const [pdf, setPdf] = useState({ status: "preparing", file: null });
  const [notice, setNotice] = useState("");
  const receiptNumber = String(sale.receiptNumber || sale.id || "");

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const file = await buildReceiptPdfFile(receiptRef.current, receiptNumber);
        if (!cancelled) setPdf({ status: "ready", file });
      } catch (error) {
        console.error("Erro ao gerar PDF do recibo:", error);
        if (!cancelled) setPdf({ status: "error", file: null });
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [receiptNumber]);

  async function handlePrint() {
    try {
      await printReceipt(receiptRef.current);
    } catch (error) {
      console.error("Erro ao imprimir recibo:", error);
      setNotice("Não foi possível abrir a impressão do recibo.");
    }
  }

  async function handleShare() {
    if (pdf.status !== "ready" || !pdf.file) return;
    setNotice("");
    if (!canShareReceiptFile(pdf.file)) {
      setNotice(
        "Este dispositivo não permite compartilhar o PDF diretamente. Baixe o arquivo para enviá-lo."
      );
      return;
    }

    try {
      await shareReceiptFile(pdf.file);
    } catch (error) {
      console.error("Erro ao compartilhar recibo:", error);
      setNotice("Não foi possível compartilhar o recibo.");
    }
  }

  async function handleRetry() {
    setPdf({ status: "preparing", file: null });
    try {
      const file = await buildReceiptPdfFile(receiptRef.current, receiptNumber);
      setPdf({ status: "ready", file });
    } catch (error) {
      console.error("Erro ao gerar PDF do recibo:", error);
      setPdf({ status: "error", file: null });
      setNotice("Não foi possível preparar o PDF do recibo.");
    }
  }

  return (
    <div className="receipt-viewer-overlay" role="presentation">
      <section
        className="receipt-viewer"
        role="dialog"
        aria-modal="true"
        aria-label="Visualizar recibo"
      >
        <header className="receipt-viewer-header">
          <div>
            <strong>Visualizar recibo</strong>
            <span>Confira os dados antes de baixar ou imprimir.</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar recibo">
            Fechar
          </button>
        </header>

        <div className="receipt-viewer-preview">
          <ReceiptTemplate
            tripOptions={tripOptions}
            ref={receiptRef}
            sale={sale}
            receiptNumber={sale.receiptNumber}
            companyName="RC Confecções"
          />
        </div>

        <footer className="receipt-viewer-actions">
          <button type="button" onClick={onClose}>Voltar</button>
          <button type="button" onClick={handlePrint}>Imprimir</button>
          <button
            type="button"
            disabled={pdf.status === "preparing"}
            onClick={
              pdf.status === "error"
                ? handleRetry
                : () => pdf.file && downloadReceiptFile(pdf.file)
            }
          >
            {pdf.status === "preparing"
              ? "Preparando PDF..."
              : pdf.status === "error"
                ? "Tentar novamente"
                : "Baixar PDF"}
          </button>
          <button
            type="button"
            disabled={pdf.status !== "ready"}
            onClick={handleShare}
          >
            Compartilhar
          </button>
        </footer>
        {notice && <p className="receipt-viewer-notice" role="status">{notice}</p>}
      </section>
    </div>
  );
}
