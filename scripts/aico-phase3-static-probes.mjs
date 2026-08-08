import fs from 'node:fs';
import path from 'node:path';

const mgmt = fs.readFileSync('apps/server/src/services/openrouter/management.ts', 'utf8');
const sms = fs.readFileSync('apps/server/src/services/sms/impls/index.ts', 'utf8');
const bill = fs.readFileSync('apps/server/src/routers/lambda/aicoBilling.ts', 'utf8');
const orgR = fs.readFileSync('apps/server/src/routers/lambda/organization.ts', 'utf8');
const mig = fs.readFileSync('packages/database/migrations/0132_shocking_blizzard.sql', 'utf8');
const wallet = fs.readFileSync('src/features/AicoWallet/index.tsx', 'utf8');
const web = fs.readFileSync('src/spa/router/desktopRouter.config.tsx', 'utf8');
const desk = fs.readFileSync('src/spa/router/desktopRouter.config.desktop.tsx', 'utf8');

const paths = ['wallet', 'platform', 'invite/:token', 'org'];
const twin = {};
for (const p of paths) {
  twin[p] = {
    desk: desk.toLowerCase().includes(p.split('/')[0]),
    web: web.includes("path: '" + p + "'") || web.includes(p),
  };
}

const probes = {
  managementSilentMock: /AICO_OPENROUTER_MOCK \|\| !aicoEnv.OPENROUTER_MANAGEMENT_API_KEY/.test(
    mgmt,
  ),
  migration0132HasDefault: /user_id" text NOT NULL DEFAULT/i.test(mig),
  mockOrgTopupRemoved: !/\bmockOrgTopup\b/.test(orgR),
  mockTopupRemoved: !/\bmockTopup\b/.test(bill),
  smsDebugFallback: /SmsImplType.Kavenegar : SmsImplType.Debug/.test(sms),
  twinPaths: twin,
  walletMockTopupRemoved: !/mockTopup/i.test(wallet) && /manualCreditHint/.test(wallet),
};

const roots = ['public/_spa/assets', 'dist/desktop/assets'];
const hits = [];
for (const r of roots) {
  if (!fs.existsSync(r)) continue;
  for (const f of fs.readdirSync(r)) {
    if (!/\.(?:js|mjs)$/.test(f)) continue;
    const full = path.join(r, f);
    const s = fs.readFileSync(full, 'utf8');
    if (/OPENROUTER_MANAGEMENT_API_KEY|KEY_VAULTS_SECRET|sk-or-v1-[A-Za-z0-9]{20,}/.test(s)) {
      hits.push(full);
    }
  }
}

const journal = JSON.parse(
  fs.readFileSync('packages/database/migrations/meta/_journal.json', 'utf8'),
);
const last = journal.entries.slice(-3).map((e) => e.tag);

const out = { probes, bundleHits: hits, migrationsTail: last };
fs.writeFileSync('aico-phase3-static-probes.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ probes, bundleHits: hits.length, migrationsTail: last }, null, 2));
