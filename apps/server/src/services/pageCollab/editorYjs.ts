import type { HeadlessEditorOptions } from '@lobehub/editor/headless';
import { YjsPlugin as EditorYjsPlugin } from '@lobehub/editor/yjs';

export { IYjsService } from '@lobehub/editor/yjs';

type HeadlessPluginConstructor = Extract<
  NonNullable<HeadlessEditorOptions['additionalPlugins']>[number],
  abstract new (...args: any[]) => unknown
>;

// `./headless` ships its own bundled copy of the kernel types, so the plugin
// class from `./yjs` is the same constructor at runtime but a distinct type.
export const YjsPlugin = EditorYjsPlugin as unknown as HeadlessPluginConstructor;
