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
export function printElement(
  elementId: string,
  opts: { title?: string; copies?: string[] } = {},
): void {
  const { title = 'เอกสาร' } = opts;
  // Labels to stamp on each printed copy. Empty string = no label. Each entry
  // prints on its own page (e.g. ['ต้นฉบับ','สำเนา'] → 2 pages).
  const copies = opts.copies && opts.copies.length ? opts.copies : [''];

  const node = document.getElementById(elementId);
  if (!node) return;

  const win = window.open('', '_blank', 'width=900,height=1200');
  if (!win) {
    window.alert('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — กรุณาอนุญาต pop-up ของเว็บนี้ แล้วลองใหม่อีกครั้งค่ะ');
    return;
  }

  // Build one section per copy: clone the node, fill its .doc-copy-label with
  // ต้นฉบับ/สำเนา, and page-break between copies.
  const sections = copies
    .map((label, i) => {
      const clone = node.cloneNode(true) as HTMLElement;
      const lbl = clone.querySelector('.doc-copy-label') as HTMLElement | null;
      if (lbl) {
        if (label) { lbl.textContent = `(${label})`; lbl.style.display = ''; }
        else { lbl.style.display = 'none'; }
      }
      const brk = i < copies.length - 1
        ? ' style="page-break-after:always;break-after:page;"'
        : '';
      return `<div${brk}>${clone.outerHTML}</div>`;
    })
    .join('');

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
    `<title>${title}</title>${head}` +
    `<style>@page{size:A4;margin:12mm}` +
    `html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}` +
    `#print-root{padding:0}</style>` +
    `</head><body><div id="print-root">${sections}</div></body></html>`,
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
