/**
 * Print a single on-screen element in an isolated popup window.
 *
 * Why a popup instead of `window.print()` + `@media print`: the document lives
 * inside a Radix dialog that centers itself with a CSS transform. A transform
 * creates a containing block, so `position:fixed`/print isolation anchors to the
 * dialog (page middle) instead of the page — the doc never sits flush at the top.
 * Cloning the element into a fresh window (with the app's stylesheets copied in)
 * sidesteps all of that: the document flows from the top and paginates normally.
 */
export function printElement(elementId: string, docTitle = 'เอกสาร'): void {
  const node = document.getElementById(elementId);
  if (!node) return;

  const win = window.open('', '_blank', 'width=900,height=1200');
  if (!win) {
    window.alert('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — กรุณาอนุญาต pop-up ของเว็บนี้ แล้วลองใหม่อีกครั้งค่ะ');
    return;
  }

  // Copy every stylesheet/link so the cloned document looks identical (Tailwind,
  // fonts, etc.). Same-origin links re-resolve fine in the new window.
  const head = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((el) => el.outerHTML)
    .join('\n');

  win.document.open();
  win.document.write(
    `<!doctype html><html lang="th"><head><meta charset="utf-8">` +
    // <base> so the copied (relative) stylesheet/image URLs resolve against the
    // app origin inside the about:blank popup.
    `<base href="${document.baseURI}">` +
    `<title>${docTitle}</title>${head}` +
    `<style>@page{size:A4;margin:12mm}` +
    `html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}` +
    `#print-root{padding:0}</style>` +
    `</head><body><div id="print-root">${node.outerHTML}</div></body></html>`,
  );
  win.document.close();

  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    try {
      win.focus();
      win.print();
    } catch { /* ignore */ }
  };
  // Print once styles + images (logo) have loaded; fallback if load already fired.
  win.onload = go;
  win.setTimeout(go, 800);
  // Tidy up after the print dialog closes (best-effort).
  win.onafterprint = () => { try { win.close(); } catch { /* ignore */ } };
}
