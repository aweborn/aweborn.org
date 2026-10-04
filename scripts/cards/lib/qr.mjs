/**
 * QR code → a single SVG <path> (dark modules only, run-length merged per row).
 */
import QRCode from "qrcode";

/**
 * @param {string} text   payload, e.g. https://aweborn.org/w/<uuid>
 * @param {object} o
 * @param {number} o.x     top-left x (user units, mm on cards)
 * @param {number} o.y     top-left y
 * @param {number} o.size  side length of the symbol, excluding quiet zone
 * @param {"L"|"M"|"Q"|"H"} [o.ecc]
 * @param {string} [o.fill]
 * @returns {{ svg: string, modules: number, moduleSize: number, version: number }}
 */
export function qrPath(text, { x, y, size, ecc = "M", fill = "#000" }) {
  const qr = QRCode.create(text, { errorCorrectionLevel: ecc });
  const n = qr.modules.size;
  const dark = (r, c) => qr.modules.data[r * n + c] === 1;

  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; ) {
      if (!dark(r, c)) { c++; continue; }
      let len = 1;
      while (c + len < n && dark(r, c + len)) len++;
      d += `M${c} ${r}h${len}v1h-${len}z`;
      c += len;
    }
  }
  const m = size / n;
  return {
    svg: `<path fill="${fill}" transform="translate(${x} ${y}) scale(${+m.toFixed(6)})" d="${d}"/>`,
    modules: n,
    moduleSize: m,
    version: qr.version,
  };
}
