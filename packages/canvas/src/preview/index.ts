import type { CanvasPreviewProject } from '../project/snapshot';
import { installCanvasBridge } from '../runtime/bridge';
import { installCanvasProject, installCanvasProjectGlobals } from './install';

export { prepareCanvasProject } from './prepare';

export const createCanvasPreviewDocument = (
  project: CanvasPreviewProject,
  page = project.entry,
  hash = '',
) => {
  const args = JSON.stringify([
    project,
    page,
    installCanvasBridge.toString(),
    installCanvasProjectGlobals.toString(),
    hash,
  ]).replaceAll('<', '\\u003c');
  const bootstrap = installCanvasProject
    .toString()
    .replaceAll(/<\/script/gi, '<' + '\\' + '/script');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'unsafe-inline' blob:; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src blob:; form-action 'none'; base-uri 'none'"><script>(${bootstrap})(...${args});</script></head><body></body></html>`;
};
