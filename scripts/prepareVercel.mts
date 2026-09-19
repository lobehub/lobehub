import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const routePath = 'src/app/(backend)/api/v1/[[...route]]/route.ts';
const sourceImport = "import lobeOpenApi from '../../../../../../packages/openapi/src';";
const compiledImport = "import lobeOpenApi from '@lobechat/openapi';";

console.log('[Vercel] Building @lobechat/openapi as a self-contained CommonJS module...');
execSync(
  'bun build ./packages/openapi/src/index.ts --outfile ./packages/openapi/dist/index.cjs --target node --format cjs',
  { stdio: 'inherit' },
);

if (existsSync(routePath)) {
  const current = readFileSync(routePath, 'utf8');
  if (current.includes(sourceImport)) {
    writeFileSync(routePath, current.replace(sourceImport, compiledImport));
    console.log('[Vercel] Switched the API route to the compiled OpenAPI entry.');
  } else if (current.includes(compiledImport)) {
    console.log('[Vercel] API route already uses the compiled OpenAPI entry.');
  } else {
    throw new Error(`[Vercel] Unexpected OpenAPI import in ${routePath}`);
  }
}
