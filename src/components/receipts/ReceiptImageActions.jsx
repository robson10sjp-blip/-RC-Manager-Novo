import { useEffect, useState } from "react";
import {
  buildReceiptImageFile,
  downloadReceiptFile,
  shareReceiptFile,
} from "./generateReceiptPdf";
import "./ReceiptImageActions.css";

export default function ReceiptImageActions({ receiptRef, sale, onNotice }) {
  const [image, setImage] = useState({ sale: null, status: "preparing", file: null });
  const [busy, setBusy] = useState(false);
  const status = image.sale === sale ? image.status : "preparing";
  const receiptNumber = sale.receiptNumber || sale.id;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const file = await buildReceiptImageFile(receiptRef.current, receiptNumber);
        if (!cancelled) setImage({ sale, status: "ready", file });
      } catch (error) {
        console.error("Erro ao preparar imagem do recibo:", error);
        if (!cancelled) setImage({ sale, status: "error", file: null });
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [sale, receiptNumber, receiptRef]);

  async function exportImage(share) {
    if (busy) return;
    setBusy(true);
    onNotice("");
    let file = status === "ready" ? image.file : null;
    try {
      if (!file) {
        file = await buildReceiptImageFile(receiptRef.current, receiptNumber);
        setImage({ sale, status: "ready", file });
      }
      if (!share) {
        downloadReceiptFile(file);
      } else {
        const result = await shareReceiptFile(file);
        if (result === "unsupported") {
          downloadReceiptFile(file);
          onNotice("Este dispositivo não permite compartilhar a imagem diretamente. O PNG foi salvo para você enviar.");
        }
      }
    } catch (error) {
      console.error("Erro ao exportar imagem do recibo:", error);
      if (share && file) {
        downloadReceiptFile(file);
        onNotice("Não foi possível abrir o compartilhamento. O PNG foi salvo para você enviar manualmente.");
      } else {
        setImage({ sale, status: "error", file: null });
        onNotice("Não foi possível gerar a imagem do recibo. Tente novamente.");
      }
    } finally { setBusy(false); }
  }

  return <>
    <button className="rcp-image-action" type="button" disabled={busy || status === "preparing"} onClick={() => exportImage(false)}>
      {status === "preparing" ? "Preparando imagem..." : busy ? "Gerando imagem..." : "Salvar imagem"}
    </button>
    <button className="rcp-image-action" type="button" disabled={busy || status === "preparing"} onClick={() => exportImage(true)}>
      Compartilhar
    </button>
  </>;
}
