import type { FilePlan } from '../plan/planFile';

export const HOST_HTML =
  '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div><script type="module" src="./entry.tsx"></script></body></html>';

export interface HostOptions {
  hostWrapper: string;
  modules: Array<{ file: string; specifier: string }>;
  runtime: string;
  themeAttribute: string;
}

export const generateHost = ({ hostWrapper, modules, runtime, themeAttribute }: HostOptions) => `
import { Host } from ${JSON.stringify(hostWrapper)};
import { createRoot } from 'react-dom/client';
import { HostApp } from ${JSON.stringify(runtime)};
import plan from './plan.json';

const loaders: Array<[string, () => Promise<unknown>]> = [
${modules.map((entry) => `  [${JSON.stringify(entry.file)}, () => import(${JSON.stringify(entry.specifier)})],`).join('\n')}
];
const modules: Record<string, any> = {};
for (const [file, load] of loaders) {
  try {
    modules[file] = await load();
  } catch (error) {
    modules[file] = { cases: {}, error: 'MODULE_LOAD_FAILED: ' + (error instanceof Error ? error.message : String(error)) };
  }
}
const params = new URLSearchParams(location.search);
const theme = params.get('theme');
if (theme) document.documentElement.setAttribute(${JSON.stringify(themeAttribute)}, theme);
if (params.get('dir')) document.documentElement.setAttribute('dir', params.get('dir')!);
document.body.style.margin = '0';
createRoot(document.getElementById('app')!).render(
  <HostApp Host={Host} modules={modules} plan={plan} onReady={() => document.getElementById('app')!.setAttribute('data-synthetic-ready', 'true')} />,
);
`;

export type HostPlan = FilePlan[];
