import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export async function generateReceiptPdf(
  element,
  receiptNumber = "000001"
) {
  if (!element) {
    alert("Não foi possível localizar o recibo.");
    return;
  }

  const canvas = await html2canvas(element, {
    scale: 3,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
    scrollX: 0,
    scrollY: 0,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
  });

  const imageData = canvas.toDataURL("image/png", 1);

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const pageWidth = 210;
  const pageHeight = 297;

  // Ocupa toda a largura e altura de uma folha A4.
  pdf.addImage(
    imageData,
    "PNG",
    0,
    0,
    pageWidth,
    pageHeight,
    undefined,
    "FAST"
  );

  pdf.save(
    `Recibo-RC-${String(receiptNumber).padStart(6, "0")}.pdf`
  );
}