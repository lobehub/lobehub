import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOW_BUILDS_LINE = /^allowBuilds:\s*$/;
const ALLOW_BUILDS_ENTRY = /^(\s+)('[^']+'|"[^"]+"|[\w@./-]+):\s*(true|false)\s*$/;

export const parseAllowBuilds = (text) => {
  const map = {};
  const lines = text.split(/\r?\n/);
  let inBlock = false;
  for (const line of lines) {
    if (!inBlock) {
      if (ALLOW_BUILDS_LINE.test(line)) inBlock = true;
      continue;
    }
    const match = line.match(ALLOW_BUILDS_ENTRY);
    if (!match) break;
    map[match[2].replaceAll(/^['"]|['"]$/g, '')] = match[3] === 'true';
  }
  return map;
};

const quoteKey = (key) => (/[@:]/.test(key) ? `'${key}'` : key);

export const mergeAllowBuilds = ({ rootText, extraTexts }) => {
  const rootMap = parseAllowBuilds(rootText);
  const extras = {};
  for (const text of extraTexts) Object.assign(extras, parseAllowBuilds(text));
  const missing = Object.keys(extras)
    .filter((key) => !(key in rootMap))
    .sort();
  if (missing.length === 0) return rootText;
  const header = /^allowBuilds:[ \t]*\r?\n/m.exec(rootText);
  if (!header) {
    throw new Error('overlay pnpm-workspace.yaml is missing an allowBuilds block');
  }
  const nl = header[0].includes('\r') ? '\r\n' : '\n';
  const insert = missing.map((key) => `  ${quoteKey(key)}: ${extras[key]}${nl}`).join('');
  const start = header.index;
  const end = start + header[0].length;
  return `${rootText.slice(0, start)}allowBuilds:${nl}${insert}${rootText.slice(end)}`;
};

export const mergeAllowBuildsFiles = ({ rootFile, extraFiles }) => {
  const rootText = fs.readFileSync(rootFile, 'utf8');
  const extraTexts = extraFiles
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, 'utf8'));
  const next = mergeAllowBuilds({ extraTexts, rootText });
  if (next !== rootText) fs.writeFileSync(rootFile, next);
  return next;
};

const isMain =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const [rootFile, ...extraFiles] = process.argv.slice(2);
  if (!rootFile) {
    throw new Error('usage: mergeAllowBuilds.mjs <root-pnpm-workspace.yaml> [extra.yaml...]');
  }
  mergeAllowBuildsFiles({ extraFiles, rootFile });
}
