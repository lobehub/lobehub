import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { type FileReport } from '.';

export interface AssetSize {
  file: string;
  gzip: number;
  raw: number;
}

export interface BuildBaseline {
  allCss: { gzip: number; raw: number };
  allJs: { gzip: number; raw: number };
  initialCss: AssetSize[];
  initialJs: AssetSize[];
  stylexRules: number;
}

const sizeOf = (file: string, buffer: Buffer): AssetSize => ({
  file,
  gzip: gzipSync(buffer).length,
  raw: buffer.length,
});

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const sum = (sizes: AssetSize[]) =>
  sizes.reduce((acc, s) => ({ gzip: acc.gzip + s.gzip, raw: acc.raw + s.raw }), {
    gzip: 0,
    raw: 0,
  });

/** Assets the SPA HTML loads before any lazy route: the entry, modulepreloads, CSS. */
export const measureBuild = (
  distDir: string,
  htmlFile = 'index.html',
  classNamePrefix = 'lh',
): BuildBaseline => {
  const html = readFileSync(path.join(distDir, htmlFile), 'utf8');
  // Web serves assets under its base (/_spa/assets/…), desktop from the root (/assets/…).
  const resolveRef = (ref: string) =>
    [ref.replace(/^\//, ''), ref.replace(/^\/[^/]+\//, '')].find((file) =>
      existsSync(path.join(distDir, file)),
    ) ?? ref;
  const refs = (pattern: RegExp) => [
    ...new Set([...html.matchAll(pattern)].map((match) => resolveRef(match[1]))),
  ];
  const read = (file: string) => sizeOf(file, readFileSync(path.join(distDir, file)));

  const initialJs = refs(/<(?:script|link)[^>]+(?:src|href)="([^"]+\.js)"/g).map(read);
  const initialCss = refs(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g).map(read);

  const files = walk(distDir);
  const measureAll = (ext: string) =>
    sum(files.filter((f) => f.endsWith(ext)).map((f) => sizeOf(f, readFileSync(f))));

  const stylexRule = new RegExp(String.raw`\.${classNamePrefix}[\da-z]{4,}[\s,.:{]`, 'g');
  const stylexRules = initialCss.reduce(
    (count, css) =>
      count + (readFileSync(path.join(distDir, css.file), 'utf8').match(stylexRule)?.length ?? 0),
    0,
  );

  return {
    allCss: measureAll('.css'),
    allJs: measureAll('.js'),
    initialCss,
    initialJs,
    stylexRules,
  };
};

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

export const formatBaseline = (build: BuildBaseline, reports: FileReport[], distDir: string) => {
  const initialJs = sum(build.initialJs);
  const initialCss = sum(build.initialCss);
  const tiers = { A: 0, B: 0, C: 0, D: 0 };
  for (const r of reports) tiers[r.tier]++;
  const blocks = reports.reduce((n, r) => n + r.blocks, 0);

  return [
    `## StyleX migration baseline — ${distDir}`,
    '',
    '| metric | raw | gzip |',
    '| --- | --- | --- |',
    `| initial JS (${build.initialJs.length} files) | ${kb(initialJs.raw)} | ${kb(initialJs.gzip)} |`,
    `| initial CSS (${build.initialCss.length} files) | ${kb(initialCss.raw)} | ${kb(initialCss.gzip)} |`,
    `| all JS | ${kb(build.allJs.raw)} | ${kb(build.allJs.gzip)} |`,
    `| all CSS | ${kb(build.allCss.raw)} | ${kb(build.allCss.gzip)} |`,
    '',
    `- StyleX rules in initial CSS: ${build.stylexRules}`,
    `- Emotion style files: ${reports.length} (A ${tiers.A} · B ${tiers.B} · C ${tiers.C} · D ${tiers.D}), css\`\` blocks: ${blocks}`,
    '',
    '| initial JS file | raw | gzip |',
    '| --- | --- | --- |',
    ...build.initialJs
      .toSorted((a, b) => b.raw - a.raw)
      .map((s) => `| ${s.file} | ${kb(s.raw)} | ${kb(s.gzip)} |`),
  ].join('\n');
};
