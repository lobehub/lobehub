#!/usr/bin/env node
/**
 * Generate the macOS tray template icon set (black + alpha).
 *
 * Template images must contain only black pixels and an alpha channel;
 * macOS then recolors them automatically based on the menu bar theme.
 *
 * Renders two files in apps/desktop/resources:
 *   - trayTemplate.png       (@1x, 18x18)
 *   - trayTemplate@2x.png    (@2x, 36x36)
 *
 * Run: bun run apps/desktop/scripts/generate-tray-template.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'resources');

// Silhouette derived from the LobeHub logo. Eyes and mouth are cut as
// transparent holes via fill-rule=evenodd so they remain visible when
// macOS tints the entire shape in a single color.
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">
  <path fill="#000" d="M172.997 19.016c-14.027 0-19.5-11.5-41-11-23.394 0-34 13-45.5 23-1.958 1.702-11.5 7-16 9-19.683 8.748-34.5 21.5-34.5 40.5 0 20.711 17.461 37.5 39 37.5 3.536 0 6.963-.453 10.22-1.301 8.7 10.539 22.179 16.658 37.28 17.301 23.5 1 31-15.25 44.5-8.5 9.259 4.629 13.83 8.5 28.5 8.5 17.108 0 25.057-5.233 30-11 9-10.5 22.879-4 31.5-4 18.778 0 34-14.551 34-32.5 0-17.95-15.222-32.5-34-32.5-5.15 0-14.856 1.27-17-7-3.5-13.5-20.148-29-44-29-9.318 0-17.691 1-23 1z"/>
  <path fill="#000" fill-rule="evenodd" d="M294 172.519c0 75.655-59.442 128.5-134 128.5-74.558 0-134-53.845-134-129.5 0-22.5 5-32.141 31.5-35.671 47.5-6.329 72.542-3.829 102.5-3.829 29.959 0 72.556-1.27 102.5 3.829 24.5 4.171 30 8.671 31.5 36.671zM101 221.012c15.464 0 28-12.536 28-28s-12.536-28-28-28-28 12.536-28 28 12.536 28 28 28zM219 221.012c15.464 0 28-12.536 28-28s-12.536-28-28-28-28 12.536-28 28 12.536 28 28 28zM159.75 242.51c-28.25 0-35.75 3.5-35.75 3.5s3.5 27 35.75 27 35.75-27 35.75-27-7.5-3.5-35.75-3.5z"/>
</svg>
`;

async function render(size, outFile) {
  const buf = Buffer.from(svg);
  await sharp(buf, { density: Math.max(72, size * 12) })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outFile);
  console.log(`wrote ${path.relative(process.cwd(), outFile)} (${size}x${size})`);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  await render(18, path.join(outDir, 'trayTemplate.png'));
  await render(36, path.join(outDir, 'trayTemplate@2x.png'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
