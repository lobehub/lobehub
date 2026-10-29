import type { HeadlessEditorOptions } from '@lobehub/editor/headless';

type HeadlessPluginConstructor = Extract<
  NonNullable<HeadlessEditorOptions['additionalPlugins']>[number],
  abstract new (...args: any[]) => unknown
>;

// `./headless` ships its own bundled copy of the kernel types, so the plugin
// class from `./yjs` is the same constructor at runtime but a distinct type.
export const loadEditorYjs = async () => {
  const { IYjsService, YjsPlugin } = await import('@lobehub/editor/yjs');
  return { IYjsService, YjsPlugin: YjsPlugin as unknown as HeadlessPluginConstructor };
};
