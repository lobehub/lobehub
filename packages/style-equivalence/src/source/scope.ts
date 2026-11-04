import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type ScopeReason = 'added' | 'changed' | 'deleted' | 'imports-changed-style' | 'renamed';

export interface ScopeFile {
  base?: string;
  head?: string;
  reason: ScopeReason;
}

export interface ScopeOptions {
  aliases?: Record<string, string>;
  base: string;
  head: string;
  repo: string;
  restrictTo?: string[];
}

const COMPONENT = /\.tsx$/;
export const STYLE_FACTORY =
  /createStaticStyles|createStyles|stylex\.(?:create|defineVars|defineConsts|keyframes)/;
const IMPORT = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;

const git = async (repo: string, args: string[]) =>
  (await run('git', ['-C', repo, ...args], { maxBuffer: 256 * 1024 ** 2 })).stdout;

const show = async (repo: string, revision: string, file: string) => {
  try {
    return await git(repo, ['show', `${revision}:${file}`]);
  } catch {
    return '';
  }
};

const escapeRegex = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

const readBatch = (repo: string, objects: string[]) =>
  new Promise<string[]>((resolve, reject) => {
    const child = spawn('git', ['-C', repo, 'cat-file', '--batch'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', () => {
      const buffer = Buffer.concat(chunks);
      const contents: string[] = [];
      let offset = 0;
      for (let index = 0; index < objects.length; index++) {
        const newline = buffer.indexOf(10, offset);
        const header = buffer.subarray(offset, newline).toString();
        offset = newline + 1;
        const size = Number(header.split(' ')[2]);
        if (header.endsWith('missing') || Number.isNaN(size)) {
          contents.push('');
          continue;
        }
        contents.push(buffer.subarray(offset, offset + size).toString());
        offset += size + 1;
      }
      resolve(contents);
    });
    child.stdin.end(objects.map((object) => `${object}\n`).join(''));
  });

const resolveSpecifier = (from: string, specifier: string, aliases: Record<string, string>) => {
  let target: string | undefined;
  if (specifier.startsWith('.')) target = path.posix.join(path.posix.dirname(from), specifier);
  for (const [prefix, directory] of Object.entries(aliases))
    if (specifier.startsWith(prefix))
      target = path.posix.join(directory, specifier.slice(prefix.length));
  if (!target) return [];
  target = target.replace(/\/+$/, '');
  return [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`];
};

export const resolveScope = async ({
  aliases = { '@/': 'src/' },
  base,
  head,
  repo,
  restrictTo,
}: ScopeOptions): Promise<{ files: ScopeFile[] }> => {
  const allowed = restrictTo && new Set(restrictTo);
  const status = await git(repo, ['diff', '--name-status', '-M', base, head]);
  const files = new Map<string, ScopeFile>();
  const styleModules = new Set<string>();
  for (const line of status.split('\n').filter(Boolean)) {
    const [code, first, second] = line.split('\t');
    if (allowed && !allowed.has(first) && !(second && allowed.has(second))) continue;
    const kind = code[0];
    if (kind === 'R' && COMPONENT.test(second)) {
      files.set(first, { base: first, head: second, reason: 'renamed' });
      continue;
    }
    const file = second ?? first;
    if (COMPONENT.test(file)) {
      if (kind === 'A') files.set(file, { head: file, reason: 'added' });
      else if (kind === 'D') files.set(file, { base: file, reason: 'deleted' });
      else files.set(file, { base: file, head: file, reason: 'changed' });
      continue;
    }
    if (file.endsWith('.css')) styleModules.add(file);
    else if (file.endsWith('.ts')) {
      const sources = await Promise.all([show(repo, base, first), show(repo, head, file)]);
      if (sources.some((source) => STYLE_FACTORY.test(source))) styleModules.add(file);
    }
  }

  const stems = new Set<string>();
  for (const file of styleModules) {
    const stem = path.posix.basename(file).replace(/\.[^.]+$/, '');
    stems.add(stem);
    if (stem === 'index') stems.add(path.posix.basename(path.posix.dirname(file)));
  }
  const candidates = new Set<string>();
  if (stems.size) {
    const forms = [`['"/](${[...stems].map(escapeRegex).join('|')})(\\.[a-z]+|/)?['"]`];
    if (stems.has('index')) forms.push(`['"]\\.\\.?/?['"]`);
    const pattern = forms.join('|');
    let output = '';
    try {
      output = await git(repo, ['grep', '-l', '-E', pattern, head, '--', '*.tsx']);
    } catch {
      output = '';
    }
    for (const line of output.split('\n').filter(Boolean)) {
      const file = line.slice(head.length + 1);
      if (!files.has(file)) candidates.add(file);
    }
  }
  const ordered = [...candidates].sort();
  const contents = await readBatch(
    repo,
    ordered.map((file) => `${head}:${file}`),
  );
  for (const [index, candidate] of ordered.entries()) {
    const code = contents[index];
    for (const match of code.matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2];
      if (
        resolveSpecifier(candidate, specifier, aliases).some((target) => styleModules.has(target))
      ) {
        files.set(candidate, { base: candidate, head: candidate, reason: 'imports-changed-style' });
        break;
      }
    }
  }

  return {
    files: [...files.values()].sort((a, b) => (a.base ?? a.head!).localeCompare(b.base ?? b.head!)),
  };
};
