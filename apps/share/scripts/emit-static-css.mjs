import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { antdStaticCssOptions, themeVarsCssOptions } from '../staticCssOptions.mjs';

process.env.NODE_ENV = 'production';

const { buildAntdStaticCss, buildThemeVarsCss } = await import('@lobehub/ui/static-css');

const clientAssetsDir = new URL('../build/client/assets/', import.meta.url);
await mkdir(clientAssetsDir, { recursive: true });

const antd = buildAntdStaticCss(antdStaticCssOptions);
const themeVars = buildThemeVarsCss(themeVarsCssOptions);

for (const payload of [antd, themeVars]) {
  // href may be CDN-absolute; the local mirror always lives at assets/<basename>.
  const fileName = new URL(payload.href, 'https://placeholder.invalid').pathname.split('/').at(-1);
  const target = new URL(fileName, clientAssetsDir);
  await writeFile(target, payload.css, 'utf8');
  console.log(fileURLToPath(target));
}

if (antd.failedProbes.length > 0) {
  console.error('static-css failed probes:', antd.failedProbes);
  process.exit(1);
}
