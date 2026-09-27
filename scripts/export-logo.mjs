/**
 * Aweborn Logo Export Script
 * 
 * Converts aweborn-logo.svg → PNGs at standard sizes for:
 * - Favicons (16, 32, 48)
 * - Apple touch icon (180)
 * - PWA manifest icons (192, 512)
 * - High-res master (1024)
 * - Open Graph / social (1200×630)
 * 
 * Also generates the main aweborn-logo.png at 1024px.
 */

import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const publicDir = join(rootDir, 'public');

// Read the source SVG (monochrome — used for full-size logo)
const svgSource = readFileSync(join(rootDir, 'aweborn-logo.svg'), 'utf-8');

// Favicon-optimized colors (F1: steel blue → lilac → gold)
// All mid-tones — visible on any tab bar color (light, dark, custom)
const faviconSvgSource = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 120 200 160" width="200" height="160">
  <circle cx="177" cy="198" r="55" fill="#5b8cb8"/>
  <circle cx="247" cy="217" r="34" fill="#a480b8"/>
  <circle cx="234" cy="173" r="21" fill="#e8c860"/>
</svg>`;

// Standard export sizes (square)
const squareSizes = [16, 32, 48, 180, 192, 512, 1024];

// For square exports, we need to make the SVG square first
// Tight bounding box of the three circles:
//   Largest:  cx=177 cy=198 r=55 → x: 122-232, y: 143-253
//   Medium:   cx=247 cy=217 r=34 → x: 213-281, y: 183-251
//   Smallest: cx=234 cy=173 r=21 → x: 213-255, y: 152-194
//   Tight BB: x: 122-281 (w=159), y: 143-253 (h=110)
//   Center: (201.5, 198)
function makeSquareSvg(svgStr, size) {
  // Use the tight bounding box + 4px padding on each side
  const pad = 4;
  const minX = 122, maxX = 281, minY = 143, maxY = 253;
  const bbW = maxX - minX; // 159
  const bbH = maxY - minY; // 110
  const squareDim = Math.max(bbW, bbH) + pad * 2; // 167

  // Center the content in the square
  const cx = (minX + maxX) / 2; // 201.5
  const cy = (minY + maxY) / 2; // 198
  const newX = cx - squareDim / 2;
  const newY = cy - squareDim / 2;

  return svgStr
    .replace(/viewBox="[^"]*"/, `viewBox="${newX} ${newY} ${squareDim} ${squareDim}"`)
    .replace(/width="[^"]*"/, `width="${size}"`)
    .replace(/height="[^"]*"/, `height="${size}"`);
}

// For OG image (1200×630), center logo on dark background
function makeOgSvg() {
  // Logo bounding box: x 122-281, y 152-251 → center ≈ (201, 201), size ≈ 159×99
  // At scale 2.2: size ≈ 350×218
  // Canvas: 1200×630 → center at (600, 315)
  // Translate: 600 - 201*2.2 = 600-442 = 158, 315 - 201*2.2 = 315-442 = -127
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="#0f1729"/>
  <g transform="translate(158, -127) scale(2.2)">
    <circle cx="177" cy="198" r="55" fill="#d4d4d8"/>
    <circle cx="247" cy="217" r="34" fill="#a1a1aa"/>
    <circle cx="234" cy="173" r="21" fill="#ffffff"/>
  </g>
</svg>`;
}

async function exportAll() {
  console.log('🎨 Exporting Aweborn logo...\n');

  // Square PNG exports
  for (const size of squareSizes) {
    // Use F1 colors for icons, monochrome for the 1024px master
    const source = size === 1024 ? svgSource : faviconSvgSource;
    const squareSvg = makeSquareSvg(source, size);
    const filename = size === 1024 
      ? 'aweborn-logo.png'
      : size === 180 
        ? 'apple-touch-icon.png'
        : `icon-${size}.png`;
    
    const outputPath = size === 1024
      ? join(rootDir, filename)
      : join(publicDir, filename);

    await sharp(Buffer.from(squareSvg))
      .resize(size, size)
      .png()
      .toFile(outputPath);
    
    console.log(`  ✓ ${filename} (${size}×${size}) ${size === 1024 ? '[monochrome]' : '[F1 colors]'}`);
  }

  // OG image (1200×630) — stays monochrome
  const ogSvg = makeOgSvg();
  await sharp(Buffer.from(ogSvg))
    .resize(1200, 630)
    .png()
    .toFile(join(publicDir, 'og-image.png'));
  console.log('  ✓ og-image.png (1200×630) [monochrome]');

  // Favicon SVG — uses F1 colors
  const faviconSvg = makeSquareSvg(faviconSvgSource, 32)
    .replace(/width="[^"]*"/, 'width="100%"')
    .replace(/height="[^"]*"/, 'height="100%"');
  
  const { writeFileSync } = await import('fs');
  writeFileSync(join(publicDir, 'favicon.svg'), faviconSvg);
  console.log('  ✓ favicon.svg [F1 colors]');

  console.log('\n✨ All exports complete!');
}

exportAll().catch(console.error);
