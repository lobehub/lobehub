import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const manifestPath =
  process.env.WORKBENCH_MANIFEST || path.resolve(repoRoot, 'apps/workbench/build-inputs.txt');

// Inputs the bundle graph cannot see: build config and its imports, dependency
// versions, and files matched by import.meta.glob patterns that may not have
// existed at the last build.
const META_TRIGGERS = [
  (file) => file.startsWith('apps/workbench/'),
  (file) => file.startsWith('plugins/vite/'),
  (file) => file.startsWith('packages/locales/src/default/'),
  (file) => /^locales\/[^/]+\/verify\.json$/.test(file),
  (file) => file === 'pnpm-lock.yaml',
  (file) => file === 'tsconfig.json',
  (file) => file === '.github/workflows/deploy-workbench.yml',
  (file) => file === '.github/workflows/verify-workbench.yml',
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
    ? `${hits.length} workbench build input(s) changed:`
    : `no workbench build inputs among ${changed.length} changed file(s)`,
  hits.slice(0, 20),
);
