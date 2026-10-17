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

/**
 * Styled QR → SVG path markup. Same symbol and error correction as qrPath
 * (so scanners decode it identically), drawn with round data dots and rounded
 * finder "eyes". Design rule: every module keeps its full cell (dots are at
 * least ~90% of the cell) so print dot-gain cannot close the gaps.
 *
 * @param {string} text
 * @param {object} o
 * @param {number} o.x @param {number} o.y @param {number} o.size  same as qrPath
 * @param {"L"|"M"|"Q"|"H"} [o.ecc]
 * @param {"dot"|"square"} [o.shape]   data module shape
 * @param {number} [o.dot]             dot diameter as a fraction of the cell (0.7–1)
 * @param {string} [o.ink]             data module colour
 * @param {string} [o.eyeOuter]        finder ring colour (default ink)
 * @param {string} [o.eyeInner]        finder pupil colour (default eyeOuter)
 */
export function qrStyled(text, { x, y, size, ecc = "M", shape = "dot", dot = 0.92, ink = "#000", eyeOuter, eyeInner }) {
  const qr = QRCode.create(text, { errorCorrectionLevel: ecc });
  const n = qr.modules.size;
  const dark = (r, c) => qr.modules.data[r * n + c] === 1;
  const inEye = (r, c) =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  eyeOuter ??= ink;
  eyeInner ??= eyeOuter;

  let data = "";
  const rad = (dot / 2).toFixed(3);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!dark(r, c) || inEye(r, c)) continue;
      data += shape === "dot"
        ? `<circle cx="${c + 0.5}" cy="${r + 0.5}" r="${rad}"/>`
        : `<rect x="${c}" y="${r}" width="1" height="1"/>`;
    }
  }
  // Finder: 7×7 ring 1 module thick (even-odd) + 3×3 pupil, rounded.
  const eye = (cx, cy) => {
    // Outer 7×7 rounded rect minus inner 5×5 rounded rect → ring.
    const outer = `M${cx + 2} ${cy}h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z`;
    const inner = `M${cx + 2.6} ${cy + 1}h1.8a1.6 1.6 0 0 1 1.6 1.6v1.8a1.6 1.6 0 0 1-1.6 1.6h-1.8a1.6 1.6 0 0 1-1.6-1.6v-1.8a1.6 1.6 0 0 1 1.6-1.6z`;
    return {
      ring: `<path fill="${eyeOuter}" fill-rule="evenodd" d="${outer}${inner}"/>`,
      pupil: `<rect x="${cx + 2}" y="${cy + 2}" width="3" height="3" rx="1" fill="${eyeInner}"/>`,
    };
  };
  const eyes = [eye(0, 0), eye(n - 7, 0), eye(0, n - 7)].map((e) => e.ring + e.pupil).join("");
  const m = size / n;
  return {
    svg: `<g transform="translate(${x} ${y}) scale(${+m.toFixed(6)})"><g fill="${ink}">${data}</g>${eyes}</g>`,
    modules: n,
    moduleSize: m,
    version: qr.version,
  };
}
