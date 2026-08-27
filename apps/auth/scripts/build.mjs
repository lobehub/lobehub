import { execFile, execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const { DEFAULT_PRERENDER_LOCALE, PRERENDER_LOCALES, PRERENDER_ROUTES, prerenderOutputDir } =
  await import(new URL('../app/lib/prerender.ts', import.meta.url).href);

const AUTH_NAMESPACES = ['auth', 'authError', 'common', 'error', 'marketAuth', 'oauth'];

// The matrix is a hand-written list because `react-router.config.ts` is loaded
// by plain Node, which cannot resolve the repo's aliases. Check it against the
// dictionaries on disk so a new translation is never silently left un-rendered.
const assertLocaleMatrix = async () => {
  const localesDir = path.resolve(appRoot, '../../locales');
  const onDisk = (await readdir(localesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const complete = [];
  for (const locale of onDisk) {
    const files = new Set(await readdir(path.join(localesDir, locale)));
    if (AUTH_NAMESPACES.every((ns) => files.has(`${ns}.json`))) complete.push(locale);
  }

  const missing = complete.filter((locale) => !PRERENDER_LOCALES.includes(locale));
  const extra = PRERENDER_LOCALES.filter((locale) => !complete.includes(locale));

  if (missing.length > 0 || extra.length > 0)
    throw new Error(
      `PRERENDER_LOCALES is out of sync with locales/: ` +
        `${missing.length > 0 ? `missing ${missing.join(', ')}; ` : ''}` +
        `${extra.length > 0 ? `no dictionaries for ${extra.join(', ')}` : ''}`,
    );

  console.log(
    `Locale matrix: ${PRERENDER_LOCALES.length} locales x ${PRERENDER_ROUTES.length} routes`,
  );
};

const run = (command, args, env) =>
  execFileSync(command, args, { cwd: appRoot, env: { ...process.env, ...env }, stdio: 'inherit' });

const buildPass = (locale, buildDir) => {
  console.log(`\n=== Prerender pass: ${locale} -> ${buildDir} ===`);
  run('node_modules/.bin/react-router', ['build', '-c', 'vite.config.rr.mts'], {
    AUTH_BUILD_DIR: buildDir,
    AUTH_PRERENDER_LOCALE: locale,
  });
};

// A pass costs about two cores, and the passes after the first one only exist
// to produce their four documents — their client output is identical and gets
// thrown away, so they are pure fan-out.
const CONCURRENCY =
  Number(process.env.AUTH_BUILD_CONCURRENCY) ||
  Math.max(1, Math.min(6, availableParallelism() - 2));

const buildPassAsync = async (locale, buildDir) => {
  const started = Date.now();
  // Output is captured rather than inherited: eighteen interleaved vite logs
  // are unreadable, and a failure still surfaces through the rejection.
  await execFileAsync('node_modules/.bin/react-router', ['build', '-c', 'vite.config.rr.mts'], {
    cwd: appRoot,
    env: { ...process.env, AUTH_BUILD_DIR: buildDir, AUTH_PRERENDER_LOCALE: locale },
    maxBuffer: 64 * 1024 * 1024,
  }).catch((error) => {
    throw new Error(
      `prerender pass ${locale} failed:\n${error.stderr || error.stdout || error.message}`,
    );
  });

  return Date.now() - started;
};

const pool = async (items, worker) => {
  const queue = [...items];

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await worker(item);
    }),
  );
};

const { SERVER_CONFIG_PLACEHOLDER } = await import(
  new URL('../app/lib/serverConfig.ts', import.meta.url).href
);

const assertDocument = async (html, clientDir, label) => {
  if (!html.includes(SERVER_CONFIG_PLACEHOLDER))
    throw new Error(`${label} lost the server-config placeholder the worker replaces`);

  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  if (!title) throw new Error(`${label} rendered without a title`);

  if (!/<meta[^>]+name="robots"/.test(html))
    throw new Error(`${label} rendered without a robots directive`);

  await assertAssetsResolve(html, clientDir, label);
};

const assertAssetsResolve = async (html, clientDir, label) => {
  const referenced = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  for (const asset of new Set(referenced)) {
    await stat(path.join(clientDir, asset)).catch(() => {
      throw new Error(`${label} references a missing asset: ${asset}`);
    });
  }
};

const main = async () => {
  const defaultClient = path.join(appRoot, 'build/client');

  await assertLocaleMatrix();

  buildPass(DEFAULT_PRERENDER_LOCALE, 'build');

  // Emitted before the locale passes so their documents can be checked against
  // the complete asset set they reference.
  console.log('\n=== Static CSS ===');
  run('node', ['scripts/emit-static-css.mjs']);

  for (const route of [...PRERENDER_ROUTES, '']) {
    const document = path.join(defaultClient, prerenderOutputDir(route), 'index.html');
    await assertDocument(
      await readFile(document, 'utf8'),
      defaultClient,
      `${DEFAULT_PRERENDER_LOCALE}${route || '/ (spa fallback)'}`,
    );
  }

  const remaining = PRERENDER_LOCALES.filter((locale) => locale !== DEFAULT_PRERENDER_LOCALE);
  console.log(`\n=== ${remaining.length} locale passes, ${CONCURRENCY} at a time ===`);

  let done = 0;

  await pool(remaining, async (locale) => {
    const buildDir = `build-${locale}`;
    const elapsed = await buildPassAsync(locale, buildDir);

    for (const route of PRERENDER_ROUTES) {
      const source = path.join(
        appRoot,
        buildDir,
        'client',
        prerenderOutputDir(route),
        'index.html',
      );
      const target = path.join(
        defaultClient,
        '__i18n',
        locale,
        prerenderOutputDir(route),
        'index.html',
      );

      // Only the SSR environment carries the locale, so every pass emits the
      // same client assets — a stale hash here means that stopped being true.
      await assertDocument(await readFile(source, 'utf8'), defaultClient, `${locale}${route}`);

      await mkdir(path.dirname(target), { recursive: true });
      await cp(source, target);
    }

    await rm(path.join(appRoot, buildDir), { force: true, recursive: true });
    done += 1;
    console.log(
      `  [${String(done).padStart(2)}/${remaining.length}] ${locale.padEnd(6)} ${PRERENDER_ROUTES.length} documents in ${(elapsed / 1000).toFixed(1)}s`,
    );
  });

  console.log('\n=== Worker ===');
  run('node_modules/.bin/vite', ['build', '-c', 'vite.config.worker.mts']);

  console.log(`\nBuilt ${(await readdir(defaultClient)).length} top-level client entries.`);
};

await main();
