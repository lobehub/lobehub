import path from 'node:path';

import { auditFunctionTrace } from './trace';

const routes = [
  'trpc/lambda/[trpc]',
  'trpc/mobile/[trpc]',
  'api/v1/[[...route]]',
  'api/agent/[[...route]]',
  'api/workflows/[[...route]]',
  'api/webhooks/[[...route]]',
  'webapi/create-image/comfyui',
];
const report = [];
for (const route of routes) {
  const manifest = path.resolve('.next/server/app/(backend)', route, 'route.js.nft.json');
  report.push({ route, ...(await auditFunctionTrace(manifest)) });
}
console.info(JSON.stringify({ kind: 'next-nft-uncompressed', functions: report }, null, 2));
if (!process.env.DOCKER && report.some((entry) => entry.bytes >= 250 * 1024 * 1024))
  throw new Error(
    'Next traced function exceeds 250 MiB; inspect the final Vercel bundle before releasing',
  );
