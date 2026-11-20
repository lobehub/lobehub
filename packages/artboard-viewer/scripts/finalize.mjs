import { createHash } from 'node:crypto';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VIEWER = 'artboard-viewer.js';

export const finalizeArtboardViewer = async (dist, major) => {
  const cssFiles = (await readdir(dist)).filter((file) => file.endsWith('.css'));
  if (cssFiles.length) {
    const css = (
      await Promise.all(cssFiles.map((file) => readFile(path.join(dist, file), 'utf8')))
    ).join('\n');
    const literal = JSON.stringify(css)
      .replaceAll('<', String.raw`\u003c`)
      .replaceAll('\u2028', String.raw`\u2028`)
      .replaceAll('\u2029', String.raw`\u2029`);
    const file = path.join(dist, VIEWER);
    const inject = `(function(){if(document.getElementById('lobe-artboard-viewer-style'))return;var s=document.createElement('style');s.id='lobe-artboard-viewer-style';s.textContent=${literal};(document.head||document.documentElement).appendChild(s)})();\n`;
    await writeFile(file, inject + (await readFile(file, 'utf8')));
    await Promise.all(cssFiles.map((file) => rm(path.join(dist, file))));
  }
  const bytes = await readFile(path.join(dist, VIEWER));
  const files = [
    { path: VIEWER, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length },
  ];
  const revision = createHash('sha256')
    .update(JSON.stringify([major, files.map((file) => [file.path, file.sha256, file.size])]))
    .digest('hex');
  const manifest = { files, major, revision };
  await writeFile(path.join(dist, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = await readFile(path.resolve(here, '../../types/src/artboardPublish.ts'), 'utf8');
  const major = Number(/ARTBOARD_VIEWER_MAJOR = (\d+)/.exec(source)?.[1]);
  if (!Number.isInteger(major) || major < 1) throw new Error('Missing artboard viewer major');
  console.log(JSON.stringify(await finalizeArtboardViewer(path.resolve(here, '../dist'), major)));
}
