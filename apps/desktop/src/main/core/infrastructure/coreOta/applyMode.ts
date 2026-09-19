import type { RendererTreeFile } from './manifest';

export type ApplyMode = 'reload' | 'relaunch';

export const computeApplyMode = (from: RendererTreeFile[], to: RendererTreeFile[]): ApplyMode => {
  const a = new Map(from.map((file) => [file.path, file.sha256]));
  const b = new Map(to.map((file) => [file.path, file.sha256]));
  const changed = [...new Set([...a.keys(), ...b.keys()])].filter((p) => a.get(p) !== b.get(p));
  return changed.every((p) => p.startsWith('dist/renderer/')) ? 'reload' : 'relaunch';
};
