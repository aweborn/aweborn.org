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

// Read the source SVG
const svgSource = readFileSync(join(rootDir, 'aweborn-logo.svg'), 'utf-8');

// Standard export sizes (square)
const squareSizes = [16, 32, 48, 180, 192, 512, 1024];

// For square exports, we need to make the SVG square first
// The logo viewBox is "100 120 200 160" — wider than tall
// We'll pad it to square for icon use
function makeSquareSvg(svgStr, size) {
  // Parse the viewBox
  // Original: viewBox="100 120 200 160"
  // Width=200, Height=160, so we need to pad height
  const vbWidth = 200;
  const vbHeight = 160;
  const maxDim = Math.max(vbWidth, vbHeight);
  
  // Center the content in a square viewBox
  const newX = 100 - (maxDim - vbWidth) / 2;
  const newY = 120 - (maxDim - vbHeight) / 2;
  
  return svgStr
    .replace(/viewBox="[^"]*"/, `viewBox="${newX} ${newY} ${maxDim} ${maxDim}"`)
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
    const squareSvg = makeSquareSvg(svgSource, size);
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
    
    console.log(`  ✓ ${filename} (${size}×${size})`);
  }

  // OG image (1200×630)
  const ogSvg = makeOgSvg();
  await sharp(Buffer.from(ogSvg))
    .resize(1200, 630)
    .png()
    .toFile(join(publicDir, 'og-image.png'));
  console.log('  ✓ og-image.png (1200×630)');

  // Favicon SVG (copy the logo SVG to public/favicon.svg)
  // Make a version optimized for favicon use (square viewBox)
  const faviconSvg = makeSquareSvg(svgSource, 32)
    .replace(/width="[^"]*"/, 'width="100%"')
    .replace(/height="[^"]*"/, 'height="100%"');
  
  const { writeFileSync } = await import('fs');
  writeFileSync(join(publicDir, 'favicon.svg'), faviconSvg);
  console.log('  ✓ favicon.svg');

  console.log('\n✨ All exports complete!');
}

exportAll().catch(console.error);
