import { createHash } from 'node:crypto';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const finalizeCanvasRuntime = async (dist, major) => {
  const entries = await readdir(dist);
  const cssFiles = entries.filter((file) => file.endsWith('.css'));
  if (cssFiles.some((file) => file !== 'canvas-runtime.css'))
    throw new Error('Canvas add-ons must not emit CSS; style them in base.css');
  if (cssFiles.length) {
    const css = (
      await Promise.all(cssFiles.map((file) => readFile(path.join(dist, file), 'utf8')))
    ).join('\n');
    const literal = JSON.stringify(css)
      .replaceAll('<', String.raw`\u003c`)
      .replaceAll('\u2028', String.raw`\u2028`)
      .replaceAll('\u2029', String.raw`\u2029`);
    const file = path.join(dist, 'canvas-runtime.js');
    const inject = `(function(){if(document.getElementById('lobe-canvas-style'))return;var s=document.createElement('style');s.id='lobe-canvas-style';s.textContent=${literal};(document.head||document.documentElement).appendChild(s)})();\n`;
    await writeFile(file, inject + (await readFile(file, 'utf8')));
    await Promise.all(cssFiles.map((file) => rm(path.join(dist, file))));
  }
  const files = await Promise.all(
    ['canvas-runtime.js', 'canvas-runtime-highlight.js', 'canvas-runtime-mermaid.js']
      .sort()
      .map(async (file) => {
        const bytes = await readFile(path.join(dist, file));
        return {
          path: file,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          size: bytes.length,
        };
      }),
  );
  // Tuples keep the cross-repository digest independent of JSON object key order.
  const revision = createHash('sha256')
    .update(JSON.stringify([major, files.map((file) => [file.path, file.sha256, file.size])]))
    .digest('hex');
  const manifest = { major, revision, files };
  await writeFile(path.join(dist, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = await readFile(path.resolve(here, '../../canvas/src/project/manifest.ts'), 'utf8');
  const major = Number(/CANVAS_RUNTIME_MAJOR = (\d+)/.exec(source)?.[1]);
  if (!Number.isInteger(major) || major < 1) throw new Error('Missing Canvas runtime major');
  console.log(JSON.stringify(await finalizeCanvasRuntime(path.resolve(here, '../dist'), major)));
}
