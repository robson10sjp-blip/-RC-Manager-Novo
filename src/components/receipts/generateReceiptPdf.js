import html2canvas from "html2canvas";
import jsPDF from "jspdf";

const A5_WIDTH_MM = 148;
const A5_HEIGHT_MM = 210;
const RENDER_TIMEOUT_MS = 30000;

function withTimeout(promise, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), RENDER_TIMEOUT_MS);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Telas pequenas geram canvas muito grandes; limita a escala para não estourar a memória do celular.
function getCaptureScale() {
  const isSmallScreen =
    typeof window !== "undefined" && window.innerWidth < 900;
  return isSmallScreen ? 2.5 : 3;
}

async function capturePage(pageElement, index) {
  return withTimeout(
    html2canvas(pageElement, {
      scale: getCaptureScale(),
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: 1280,
      onclone: (clonedDocument) => {
        const clonedPage = clonedDocument.querySelector(
          `[data-rcp-page="${index}"]`
        );

        if (!clonedPage) return;

        clonedDocument.body.style.margin = "0";
        clonedDocument.body.appendChild(clonedPage);

        Object.assign(clonedPage.style, {
          position: "absolute",
          top: "0",
          left: "0",
          margin: "0",
          zoom: "1",
          boxShadow: "none",
          border: "0",
          borderRadius: "0",
        });
      },
    }),
    "Tempo esgotado ao gerar o PDF do recibo."
  );
}

// Cada página A5 do recibo vira uma página do PDF, com o mesmo layout da visualização e da impressão.
async function renderReceiptPdf(element) {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const pages = Array.from(element.querySelectorAll("[data-rcp-page]"));

  if (pages.length === 0) {
    throw new Error("Não foi possível localizar as páginas do recibo.");
  }

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a5",
    compress: true,
  });

  for (let index = 0; index < pages.length; index += 1) {
    const canvas = await capturePage(pages[index], index);

    if (!canvas.width || !canvas.height) {
      throw new Error("Não foi possível desenhar o recibo.");
    }

    if (index > 0) pdf.addPage("a5", "portrait");

    pdf.addImage(
      canvas.toDataURL("image/jpeg", 0.95),
      "JPEG",
      0,
      0,
      A5_WIDTH_MM,
      A5_HEIGHT_MM,
      undefined,
      "FAST"
    );
  }

  return pdf;
}

// Imprime em um iframe isolado, para a impressão ter o mesmo layout A5 do PDF
// sem páginas em branco da tela do sistema.
export async function printReceipt(element) {
  if (!element) throw new Error("Recibo não encontrado.");

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
  });
  document.body.appendChild(iframe);

  const frameDocument = iframe.contentDocument;
  frameDocument.open();
  frameDocument.write(
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>Recibo RC Confecções</title></head><body></body></html>"
  );
  frameDocument.close();

  document
    .querySelectorAll('style, link[rel="stylesheet"]')
    .forEach((node) => frameDocument.head.appendChild(node.cloneNode(true)));
  frameDocument.body.innerHTML = element.outerHTML;

  await new Promise((resolve) => setTimeout(resolve, 600));
  if (frameDocument.fonts?.ready) await frameDocument.fonts.ready;

  iframe.contentWindow.focus();
  iframe.contentWindow.print();
  setTimeout(() => iframe.remove(), 60000);
}

export async function generateReceiptPdf(
  element,
  receiptNumber = "000001"
) {
  if (!element) {
    alert("Não foi possível localizar o recibo.");
    return;
  }

  const pdf = await renderReceiptPdf(element);

  pdf.save(
    `Recibo-RC-${String(receiptNumber).padStart(6, "0")}.pdf`
  );
}

export function getShareReceiptFileName(receiptNumber) {
  const number = String(receiptNumber ?? "").replace(/\D/g, "");
  return number
    ? `Recibo-RC-Confeccoes-${number.padStart(6, "0")}.pdf`
    : "Recibo-RC-Confeccoes.pdf";
}

export async function buildReceiptPdfFile(element, receiptNumber) {
  if (!element) {
    throw new Error("Recibo não encontrado.");
  }

  const pdf = await renderReceiptPdf(element);
  return new File([pdf.output("blob")], getShareReceiptFileName(receiptNumber), {
    type: "application/pdf",
  });
}

export function canShareReceiptFile(file) {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  );
}

export function downloadReceiptFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Compartilha somente o arquivo PDF (sem title, text ou url, para não anexar links do sistema).
// Retorna "shared", "cancelled" ou "unsupported".
export async function shareReceiptFile(file) {
  if (!canShareReceiptFile(file)) return "unsupported";

  try {
    await navigator.share({ files: [file] });
    return "shared";
  } catch (error) {
    if (error?.name === "AbortError") return "cancelled";
    throw error;
  }
}
