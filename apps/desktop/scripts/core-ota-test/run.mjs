import { execSync, spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORK = path.join(DESKTOP_DIR, 'release/core-ota-e2e');
const FEED = path.join(WORK, 'feed');
const PORT = 8787;
const CDP_PORT = 9333;
const PRODUCT = 'lobehub-core-ota-e2e';
const CHANNEL = 'stable';
const APP_VERSION = '1.0.0';
const PLATFORM = 'darwin';
const APP = path.join(WORK, 'app', 'mac-arm64', `${PRODUCT}.app`, 'Contents', 'MacOS', PRODUCT);
const USER_DATA = path.join(os.homedir(), 'Library/Application Support', PRODUCT);
const LOG = path.join(os.homedir(), 'Library/Logs', PRODUCT, 'main.log');

const keys = () => ({
  privateKey: readFileSync(path.join(WORK, 'priv.pem'), 'utf8'),
  publicKey: readFileSync(path.join(WORK, 'pub.pem'), 'utf8'),
});

const sh = (cmd, env = {}) =>
  execSync(cmd, { cwd: DESKTOP_DIR, env: { ...process.env, ...env }, stdio: 'inherit' });

const coreDir = (tag) => path.join(WORK, `core-${tag}`);
const manifestOf = (tag) =>
  JSON.parse(readFileSync(path.join(coreDir(tag), 'manifest.json'), 'utf8'));

const publish = (tag, { version, seq, previous }) => {
  const { shellAbi } = manifestOf(previous ?? tag);
  const previousArg = previous
    ? `--previous-manifest=${path.join(FEED, 'core', PLATFORM, 'versions', `${manifestOf(previous).version}.json`)}`
    : '';
  sh(
    `node scripts/buildCore.mjs --core=${coreDir(tag)} --platform=${PLATFORM} --channel=${CHANNEL} ` +
      `--version=${version} --seq=${seq} --shell-abi=${shellAbi} ` +
      `--objects-base-url=http://127.0.0.1:${PORT}/cas --out=${FEED} ${previousArg}`,
    { RENDERER_OTA_PRIVATE_KEY: keys().privateKey },
  );
};

const steps = {
  keys() {
    mkdirSync(WORK, { recursive: true });
    const pair = generateKeyPairSync('ed25519');
    writeFileSync(
      path.join(WORK, 'priv.pem'),
      pair.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    );
    writeFileSync(
      path.join(WORK, 'pub.pem'),
      pair.publicKey.export({ format: 'pem', type: 'spki' }),
    );
    console.log(`keys written to ${WORK}`);
  },

  build() {
    const { privateKey, publicKey } = keys();
    const env = {
      RENDERER_OTA_PRIVATE_KEY: privateKey,
      RENDERER_OTA_PUBLIC_KEY: publicKey,
      UPDATE_CHANNEL: CHANNEL,
      UPDATE_SERVER_URL: `http://127.0.0.1:${PORT}/${CHANNEL}`,
      APP_URL: 'http://localhost:3015',
      DATABASE_URL: 'postgresql://postgres@localhost:5432/postgres',
      KEY_VAULTS_SECRET: 'oLXWIiR/AKF+rWaqy9lHkrYgzpATbW3CtJp3UfkVgpE=',
    };
    // Electron derives userData from package.json name; productName alone would share the dev instance's data.
    sh(`npm pkg set name=${PRODUCT} version=${APP_VERSION}`);
    if (!existsSync(path.join(DESKTOP_DIR, 'dist/renderer/apps/desktop/index.html'))) {
      sh('npm run build:main', env);
    } else {
      console.log('dist/ present, skipping build:main');
    }
    rmSync(path.join(WORK, 'app'), { force: true, recursive: true });
    sh(
      `npx electron-builder --dir --mac --arm64 --config electron-builder.mjs ` +
        `-c.mac.notarize=false -c.mac.identity=null -c.productName=${PRODUCT} -c.directories.output=${path.join(WORK, 'app')}`,
      env,
    );
    rmSync(coreDir('v1'), { force: true, recursive: true });
    cpSync(path.join(DESKTOP_DIR, 'core-dist'), coreDir('v1'), { recursive: true });
    rmSync(FEED, { force: true, recursive: true });
    publish('v1', { seq: manifestOf('v1').seq, version: manifestOf('v1').version });
    // buildCore writes core/<platform>; the client reads <channel>/core/<platform> (S3 adds the channel prefix).
    symlinkSync('.', path.join(FEED, CHANNEL));
    console.log(`v1 app: ${APP}`);
  },

  v2() {
    rmSync(coreDir('v2'), { force: true, recursive: true });
    cpSync(coreDir('v1'), coreDir('v2'), { recursive: true });
    const html = path.join(coreDir('v2'), 'dist/renderer/apps/desktop/index.html');
    writeFileSync(
      html,
      readFileSync(html, 'utf8').replace(
        /<body[^>]*>/,
        '$&<div id="core-ota-e2e" style="position:fixed;top:8px;right:8px;z-index:99999;background:#e11;color:#fff;padding:6px 10px;font:bold 14px sans-serif">CORE V2</div>',
      ),
    );
    publish('v2', { previous: 'v1', seq: 1, version: `${APP_VERSION}-core.1` });
  },

  v3() {
    rmSync(coreDir('v3'), { force: true, recursive: true });
    cpSync(coreDir('v2'), coreDir('v3'), { recursive: true });
    appendFileSync(path.join(coreDir('v3'), 'dist/main/index.js'), "\nconsole.log('core v3');\n");
    publish('v3', { previous: 'v2', seq: 2, version: `${APP_VERSION}-core.2` });
  },

  v4() {
    rmSync(coreDir('v4'), { force: true, recursive: true });
    cpSync(coreDir('v3'), coreDir('v4'), { recursive: true });
    const rendererDir = path.join(coreDir('v4'), 'dist/renderer');
    const asset = readdirSync(path.join(rendererDir, 'assets')).find((name) =>
      name.endsWith('.js'),
    );
    writeFileSync(
      path.join(rendererDir, 'apps/desktop/index.html'),
      `<html><body><script src="/assets/${asset}"></script><script>throw new Error("boot failure e2e")</script></body></html>`,
    );
    publish('v4', { previous: 'v3', seq: 3, version: `${APP_VERSION}-core.3` });
  },

  serve() {
    spawn('node', ['scripts/core-ota-test/serve.mjs', FEED, String(PORT)], {
      cwd: DESKTOP_DIR,
      stdio: 'inherit',
    });
  },

  launch() {
    const child = spawn(APP, [`--remote-debugging-port=${CDP_PORT}`], {
      detached: true,
      env: { ...process.env, RENDERER_OTA_CHECK_DELAY: '3000' },
      stdio: 'ignore',
    });
    child.unref();
    console.log(`launched pid ${child.pid}; log: ${LOG}`);
  },

  kill() {
    try {
      execSync(`pkill -f "${PRODUCT}.app/Contents/MacOS/${PRODUCT}"`);
    } catch {}
  },

  tamper() {
    const file = path.join(
      USER_DATA,
      'core-ota/cores',
      `${APP_VERSION}-core.2`,
      'dist/main/index.js',
    );
    appendFileSync(file, '\n// tampered\n');
    console.log(`tampered ${file}`);
  },

  async eval() {
    const expression = process.argv[3];
    const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
    const page = targets.find(
      (t) => t.type === 'page' && !t.url.includes('overlay') && !t.url.includes('popup'),
    );
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    const send = (method, params) =>
      new Promise((resolve) => {
        const id = Math.floor(Math.random() * 1e9);
        ws.addEventListener('message', function onMessage(event) {
          const msg = JSON.parse(event.data);
          if (msg.id !== id) return;
          ws.removeEventListener('message', onMessage);
          resolve(msg.result);
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    if (expression === '--shot') {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(process.argv[4], Buffer.from(data, 'base64'));
      console.log(`screenshot ${process.argv[4]}`);
    } else {
      const result = await send('Runtime.evaluate', {
        awaitPromise: true,
        expression,
        returnByValue: true,
      });
      console.log(JSON.stringify(result?.result?.value ?? result, null, 2));
    }
    ws.close();
  },

  state() {
    for (const name of ['pointer.json', 'boot.json']) {
      const file = path.join(USER_DATA, 'core-ota', name);
      console.log(`--- ${name}`);
      console.log(existsSync(file) ? readFileSync(file, 'utf8') : '(missing)');
    }
    const cores = path.join(USER_DATA, 'core-ota/cores');
    console.log(
      '--- cores:',
      existsSync(cores) ? readdirSync(cores).join(' ').toString().trim() : '(none)',
    );
  },

  reset() {
    rmSync(USER_DATA, { force: true, recursive: true });
    rmSync(path.dirname(LOG), { force: true, recursive: true });
    console.log('user data + logs removed');
  },

  restore() {
    sh('git checkout -- package.json');
  },
};

const step = process.argv[2];
if (!steps[step]) {
  console.error(`usage: node scripts/core-ota-test/run.mjs <${Object.keys(steps).join('|')}>`);
  process.exit(1);
}
await steps[step]();
