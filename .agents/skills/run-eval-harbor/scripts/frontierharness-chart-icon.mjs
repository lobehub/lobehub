// Add the LobeHub favicon to a FrontierHarness-generated candidate chart.
import { readFile, writeFile } from 'node:fs/promises';

import sharp from 'sharp';

const [chartPath, faviconPath] = process.argv.slice(2);
if (!chartPath || !faviconPath) {
  throw new Error('usage: node frontierharness-chart-icon.mjs <chart.svg> <favicon.ico>');
}

const ico = await readFile(faviconPath);
const offset = ico.readUInt32LE(18);
const size = ico.readUInt32LE(14);
const png = ico.subarray(offset, offset + size);
if (!png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
  throw new Error('favicon does not contain a PNG image');
}

const source = await readFile(chartPath, 'utf8');
const candidate =
  /<text class="point-name" x="([\d.]+)" y="([\d.]+)" fill="#ff7a12" text-anchor="(start|end)"><tspan x="[\d.]+">LobeHub<\/tspan>/;
const match = source.match(candidate);
if (!match) throw new Error('LobeHub candidate label is missing from the chart');
const [, rawX, rawY, anchor] = match;
const x = Number(rawX) + (anchor === 'end' ? -88 : -23);
const y = Number(rawY) - 14;
const image = `<image x="${x}" y="${y}" width="18" height="18" href="data:image/png;base64,${png.toString('base64')}"/>`;
const chart = source
  .replace(candidate, `${image}${match[0]}`)
  .replace(
    'Provisional comparison · Cost coverage: see report data',
    'LobeHub · local Docker run · shown for context, not ranked',
  )
  .replace('>Third-party harness</text>', '>LobeHub</text>');
await writeFile(chartPath, chart);
await sharp(Buffer.from(chart))
  .png()
  .toFile(chartPath.replace(/\.svg$/, '.png'));
console.log(`Branded ${chartPath}`);
