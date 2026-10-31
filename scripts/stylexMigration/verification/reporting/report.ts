import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

export const writeJson = async (directory: string, file: string, value: unknown) => {
  const target = path.resolve(directory, file);
  if (!target.startsWith(directory + path.sep)) throw new Error('UNSAFE_ARTIFACT_PATH');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
};

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const writeHtmlReport = async (directory: string, value: unknown) => {
  await writeFile(
    path.join(directory, 'report.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Style migration verification</title><style>body{font:14px system-ui;max-width:1100px;margin:32px auto;padding:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><h1>Style migration verification</h1><p>Local evidence only. A preflight or self-test is not a PR gate approval.</p><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></body></html>`,
    { flag: 'wx' },
  );
};

export const fingerprintSources = async (directories: string[]) => {
  const hash = createHash('sha256');
  const visit = async (directory: string, prefix: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const name = `${prefix}/${entry.name}`;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file, name);
      else if (entry.isFile())
        hash
          .update(name)
          .update('\0')
          .update(sha256(await readFile(file)))
          .update('\0');
      else throw new Error('VERIFIER_SOURCE_SYMLINK_UNSUPPORTED');
    }
  };
  for (const [index, directory] of directories.entries()) await visit(directory, String(index));
  return hash.digest('hex');
};

export const writeArtifactManifest = async (directory: string, files: string[]) => {
  const manifest = await Promise.all(
    files.map(async (file) => {
      const target = path.resolve(directory, file);
      if (!target.startsWith(directory + path.sep)) throw new Error('UNSAFE_ARTIFACT_PATH');
      const data = await readFile(target);
      return { bytes: data.length, path: file, sha256: sha256(data) };
    }),
  );
  await writeJson(directory, 'artifacts.json', manifest);
  return manifest;
};
