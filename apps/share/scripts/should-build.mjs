import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const manifestPath =
  process.env.SHARE_MANIFEST || path.resolve(repoRoot, 'apps/share/build-inputs.txt');

// Inputs the bundle graph cannot see: build config and its imports, dependency
// versions, and files matched by import.meta.glob patterns that may not have
// existed at the last build.
//
// Matched anywhere in the path, not anchored: a host repo that builds this app
// from a submodule reports the same files under its own prefix
// (`lobehub/apps/share/...`), and both spellings must trigger.
const META_TRIGGER_SEGMENTS = [
  'apps/share/',
  'plugins/vite/',
  'packages/locales/src/default/',
  'pnpm-lock.yaml',
  'tsconfig.json',
];
const BUNDLED_LOCALE = /locales\/[^/]+\/(?:chat|error|pageShare)\.json$/;

const META_TRIGGERS = [
  (file) => META_TRIGGER_SEGMENTS.some((segment) => file.includes(segment)),
  (file) => BUNDLED_LOCALE.test(file),
];

const emit = (shouldBuild, reason, hits = []) => {
  console.log(reason);
  for (const hit of hits) console.log(`  ${hit}`);
  console.log(`should_build=${shouldBuild}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `should_build=${shouldBuild}\n`);
  }
};

const args = process.argv.slice(2);
let changed;

if (args[0] === '--files') {
  changed = args.slice(1);
} else {
  const [base, head = 'HEAD'] = args;
  if (!base) {
    emit(true, 'no base commit provided — building');
    process.exit(0);
  }
  try {
    changed = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    emit(true, `base commit ${base} not resolvable — building`);
    process.exit(0);
  }
}

let manifestText;
try {
  manifestText = readFileSync(manifestPath, 'utf8');
} catch {
  emit(true, `manifest ${manifestPath} not available — building`);
  process.exit(0);
}

const manifest = new Set(manifestText.split('\n').filter(Boolean));
const hits = changed.filter(
  (file) => manifest.has(file) || META_TRIGGERS.some((matches) => matches(file)),
);

emit(
  hits.length > 0,
  hits.length > 0
    ? `${hits.length} share build input(s) changed:`
    : `no share build inputs among ${changed.length} changed file(s)`,
  hits.slice(0, 20),
);
