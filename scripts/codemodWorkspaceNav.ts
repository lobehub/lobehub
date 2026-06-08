#!/usr/bin/env bun
/**
 * Codemod: rewrite in-app callsites to be workspace-aware.
 *
 *   useNavigate         (from 'react-router-dom') → useWorkspaceAwareNavigate
 *   <Link to="/{shared}">                          → <WorkspaceLink to="/{shared}">
 *
 * Idempotent. Re-run after rebasing the lobehub submodule onto upstream canary
 * to re-apply Step B's workspace-aware navigation patches (LOBE-9024).
 *
 * Strategy:
 *   - Scope: lobehub/src/{features,routes,hooks} excluding tests, the router
 *     configs themselves, and the Workspace feature folder.
 *   - For each file, collect every `navigate('/...')` literal and every
 *     `<Link to="/..."`. Classify each target path as personal-only / shared /
 *     unknown using the patterns below.
 *   - If a file has ANY personal-only navigate target AND ANY shared target →
 *     mixed; skip the `useNavigate` rewrite (emit a warning) but still rewrite
 *     `<Link>` callsites individually.
 *   - If the file has only personal-only navigate targets → skip entirely
 *     (the file is correct as-is).
 *   - Otherwise rewrite `useNavigate` → `useWorkspaceAwareNavigate` and add
 *     the appropriate import.
 *
 * Run:
 *   bun run scripts/codemodWorkspaceNav.ts            # apply
 *   bun run scripts/codemodWorkspaceNav.ts --dry      # report only
 *   bun run scripts/codemodWorkspaceNav.ts --check    # exit 1 if would change
 */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SCAN_ROOTS = ['src/features', 'src/routes', 'src/hooks'];

const EXCLUDE_DIR_NAMES = new Set(['__tests__', '__mocks__', 'node_modules']);

// Files whose pathname matches these substrings are skipped.
const EXCLUDE_PATH_SUBSTRINGS = ['/spa/router/', '/features/Workspace/'];

const EXCLUDE_FILE_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx', '.d.ts'];

// Top-level personal-only routes. `/settings` is handled separately by the
// shared-tabs allowlist below so workspace-mirrored sub-paths (general, plans,
// billing, …) get auto-prefixed while truly personal sub-paths (profile, llm,
// referral, system-tools, workspace-*) stay personal.
//
// Keep in sync with `PERSONAL_PATH_REGEX` in
// `src/features/Workspace/workspaceAwarePath.ts`.
const PERSONAL_PATH_REGEX = /^\/(?:onboarding|me|share|devtools|desktop-onboarding)(?:[/?#]|$)/;

// Keep in sync with `WORKSPACE_SETTINGS_TABS` in
// `src/features/Workspace/workspaceAwarePath.ts`.
const SHARED_SETTINGS_TABS =
  '(?:apikey|billing|creds|credits|general|members|memory|messenger|plans|provider|service-model|skill|stats|usage)';

const SHARED_PATH_REGEX = new RegExp(
  `^\\/(?:agent|group|community|memory|page|resource|image|video|eval|tasks?|settings\\/${SHARED_SETTINGS_TABS})(?:[/?#]|$)`,
);

type Verdict = 'personal' | 'shared' | 'unknown';

const classifyPath = (path: string): Verdict => {
  if (PERSONAL_PATH_REGEX.test(path)) return 'personal';
  if (SHARED_PATH_REGEX.test(path)) return 'shared';
  return 'unknown';
};

const WORKSPACE_NAVIGATE_IMPORT =
  "import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';";
const WORKSPACE_LINK_IMPORT = "import WorkspaceLink from '@/features/Workspace/WorkspaceLink';";

interface Report {
  file: string;
  reason: string;
}

const reports: { transformed: Report[]; skipped: Report[]; warnings: Report[] } = {
  transformed: [],
  skipped: [],
  warnings: [],
};

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry') || args.has('--dry-run');
const CHECK = args.has('--check');

async function walk(dir: string, files: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (EXCLUDE_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
    if (EXCLUDE_FILE_SUFFIXES.some((s) => entry.name.endsWith(s))) continue;
    const rel = path.relative(ROOT, full).replaceAll('\\', '/');
    if (EXCLUDE_PATH_SUBSTRINGS.some((s) => rel.includes(s))) continue;
    files.push(full);
  }
  return files;
}

// Extract the first-arg path literal from `navigate(...)` invocations.
// Handles:  navigate('/foo'), navigate("/foo"), navigate(`/foo/${x}`)
const NAVIGATE_CALL_REGEX = /\bnavigate\s*\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;

const collectNavigateTargets = (source: string): string[] => {
  const out: string[] = [];
  for (const match of source.matchAll(NAVIGATE_CALL_REGEX)) {
    const raw = match[2];
    // Strip template-literal `${...}` placeholders so the prefix is comparable.
    const prefix = raw.replaceAll(/\$\{[^}]*\}/g, '');
    out.push(prefix);
  }
  return out;
};

const containsUseNavigateImport = (source: string): boolean =>
  /from\s+['"]react-router-dom['"]/.test(source) && /\buseNavigate\b/.test(source);

/**
 * Rewrite `import { ..., useNavigate, ... } from 'react-router-dom'`:
 *   - drop `useNavigate` from the named imports list
 *   - if no other names remain, drop the entire import line
 *   - append a new import for `useWorkspaceAwareNavigate`
 */
const rewriteImports = (source: string): string => {
  const importRegex = /^(\s*)import\s+\{([^}]+)\}\s+from\s+(['"])react-router-dom\3\s*(?:;\s*)?$/m;
  const match = source.match(importRegex);
  if (!match) return source;
  const indent = match[1];
  const names = match[2]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const remaining = names.filter((n) => n.replace(/\s+as\s+\w+/, '').trim() !== 'useNavigate');

  const newWorkspaceImport = `${indent}${WORKSPACE_NAVIGATE_IMPORT}`;

  let replacement: string;
  if (remaining.length === 0) {
    replacement = newWorkspaceImport;
  } else {
    replacement = `${indent}import { ${remaining.join(', ')} } from 'react-router-dom';\n${newWorkspaceImport}`;
  }

  return source.replace(importRegex, replacement);
};

const rewriteUseNavigateCalls = (source: string): string =>
  source.replaceAll(/\buseNavigate\s*\(\s*\)/g, 'useWorkspaceAwareNavigate()');

const ensureWorkspaceLinkImport = (source: string): string => {
  if (source.includes(WORKSPACE_LINK_IMPORT)) return source;
  // Insert right after the first `from 'react-router-dom'` import, or at top.
  const rrdImport = /^(\s*)import\s[^;]*from\s+['"]react-router-dom['"]\s*(?:;\s*)?$/m;
  const match = source.match(rrdImport);
  if (match && match.index !== undefined) {
    const insertAt = match.index + match[0].length;
    return `${source.slice(0, insertAt)}\n${match[1]}${WORKSPACE_LINK_IMPORT}${source.slice(
      insertAt,
    )}`;
  }
  // Fallback: prepend.
  return `${WORKSPACE_LINK_IMPORT}\n${source}`;
};

interface LinkRewriteResult {
  changed: boolean;
  rewrote: number;
  source: string;
}

const rewriteLinkTags = (source: string): LinkRewriteResult => {
  // Walk all `<Link …>` / `</Link>` tokens, pair opens with closes by depth,
  // collect a single list of edits, then apply them in descending-index order
  // so all positions stay valid throughout the rewrite.
  const tagRegex = /<\/?Link\b[^>]*>/g;
  interface OpenToken {
    idx: number;
    raw: string;
    rewrite: boolean;
    selfClosing: boolean;
  }
  interface CloseToken {
    idx: number;
    raw: string;
  }
  const opens: OpenToken[] = [];
  const closes: CloseToken[] = [];
  const allTokens: Array<{ kind: 'open' | 'close'; idx: number; raw: string }> = [];

  for (const m of source.matchAll(tagRegex)) {
    const raw = m[0];
    const idx = m.index!;
    if (raw.startsWith('</')) {
      closes.push({ idx, raw });
      allTokens.push({ kind: 'close', idx, raw });
      continue;
    }
    const toMatch = raw.match(/\bto\s*=\s*(?:\{\s*)?(['"`])((?:\\.|(?!\1).)*?)\1\s*\}?/);
    let rewrite = false;
    if (toMatch) {
      const prefix = toMatch[2].replaceAll(/\$\{[^}]*\}/g, '');
      if (classifyPath(prefix) === 'shared') rewrite = true;
    }
    const selfClosing = raw.endsWith('/>');
    const tok: OpenToken = { idx, raw, rewrite, selfClosing };
    opens.push(tok);
    allTokens.push({ kind: 'open', idx, raw });
  }

  // Pair opens with closes by walking the token stream in source order.
  const stack: OpenToken[] = [];
  const edits: Array<{ idx: number; length: number; replacement: string }> = [];
  let rewroteCount = 0;

  for (const t of allTokens) {
    if (t.kind === 'open') {
      const ot = opens.find((o) => o.idx === t.idx)!;
      if (ot.selfClosing) {
        if (ot.rewrite) {
          edits.push({
            idx: ot.idx,
            length: ot.raw.length,
            replacement: ot.raw.replace(/^<Link\b/, '<WorkspaceLink').replace(/\/>$/, ' />'),
          });
          rewroteCount++;
        }
        continue;
      }
      stack.push(ot);
    } else {
      const opener = stack.pop();
      if (opener?.rewrite) {
        edits.push({
          idx: opener.idx,
          length: opener.raw.length,
          replacement: opener.raw.replace(/^<Link\b/, '<WorkspaceLink'),
        });
        edits.push({
          idx: t.idx,
          length: t.raw.length,
          replacement: '</WorkspaceLink>',
        });
        rewroteCount += 2;
      }
    }
  }

  edits.sort((a, b) => b.idx - a.idx);
  let out = source;
  for (const e of edits) {
    out = `${out.slice(0, e.idx)}${e.replacement}${out.slice(e.idx + e.length)}`;
  }

  return { changed: edits.length > 0, source: out, rewrote: rewroteCount };
};

async function processFile(absPath: string): Promise<void> {
  const rel = path.relative(ROOT, absPath);
  const original = await readFile(absPath, 'utf8');
  let next = original;

  const targets = collectNavigateTargets(original);
  const verdicts = targets.map(classifyPath);
  const hasPersonal = verdicts.includes('personal');
  const hasShared = verdicts.includes('shared');

  let didUseNavigateRewrite = false;
  const hasUseNavigate = containsUseNavigateImport(original);

  if (hasUseNavigate) {
    if (hasPersonal && hasShared) {
      reports.warnings.push({
        file: rel,
        reason: 'mixed personal/shared navigate targets — useNavigate left unchanged',
      });
    } else if (hasPersonal && !hasShared) {
      // pure personal — leave as-is
    } else {
      // pure shared OR no navigate calls (e.g. only Link). The latter case is
      // safe: useNavigate is imported but unused for shared paths; flipping it
      // is a no-op behaviorally. We only flip if useNavigate is actually CALLED
      // — otherwise leave the import alone to avoid removing genuinely-unused
      // imports the codemod didn't introduce.
      if (/\buseNavigate\s*\(\s*\)/.test(original)) {
        const afterImport = rewriteImports(next);
        if (afterImport !== next) {
          next = rewriteUseNavigateCalls(afterImport);
          didUseNavigateRewrite = true;
        }
      }
    }
  }

  // Link rewrite — independent of useNavigate decision.
  const linkResult = rewriteLinkTags(next);
  if (linkResult.changed) {
    next = ensureWorkspaceLinkImport(linkResult.source);
  }

  if (next === original) {
    if (hasUseNavigate && (hasShared || hasPersonal)) {
      reports.skipped.push({
        file: rel,
        reason: hasPersonal && !hasShared ? 'personal-only navigate targets' : 'no change needed',
      });
    }
    return;
  }

  const summary: string[] = [];
  if (didUseNavigateRewrite) summary.push('useNavigate');
  if (linkResult.rewrote > 0) summary.push(`${linkResult.rewrote / 2} Link tag(s)`);

  reports.transformed.push({ file: rel, reason: summary.join(' + ') });

  if (!DRY && !CHECK) await writeFile(absPath, next, 'utf8');
}

async function main(): Promise<void> {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    const abs = path.join(ROOT, root);
    if (
      await stat(abs).then(
        () => true,
        () => false,
      )
    ) {
      await walk(abs, files);
    }
  }

  for (const f of files) await processFile(f);

  const print = (label: string, list: Report[]): void => {
    if (list.length === 0) return;
    console.log(`\n${label} (${list.length}):`);
    for (const r of list) console.log(`  ${r.file}  — ${r.reason}`);
  };

  print('TRANSFORMED', reports.transformed);
  print('WARNINGS', reports.warnings);
  if (process.env.VERBOSE) print('SKIPPED', reports.skipped);

  console.log(
    `\nSummary: transformed=${reports.transformed.length} warnings=${reports.warnings.length} skipped=${reports.skipped.length} files-scanned=${files.length}`,
  );

  if (CHECK && reports.transformed.length > 0) {
    console.error('\n✗ codemod would modify files. Re-run without --check to apply.');
    process.exit(1);
  }
}

await main();
