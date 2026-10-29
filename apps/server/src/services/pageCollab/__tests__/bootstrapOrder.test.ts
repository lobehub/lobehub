// @vitest-environment node
import { createHeadlessEditor } from '@lobehub/editor/headless';
import { expect, it } from 'vitest';
import * as Y from 'yjs';

import { loadEditorYjs } from '../editorYjs';
import { projectPageState } from '../fork';

it('bootstraps once when content is loaded after the provider synced', async () => {
  const { YjsPlugin } = await loadEditorYjs();
  const listeners = new Map<string, Set<(...a: any[]) => void>>();
  const provider: any = {
    awareness: {
      getLocalState: () => null,
      getStates: () => new Map(),
      off() {},
      on() {},
      setLocalState() {},
      setLocalStateField() {},
    },
    connect() {},
    disconnect() {},
    emit: (t: string, ...a: any[]) => listeners.get(t)?.forEach((cb) => cb(...a)),
    off: (t: string, cb: any) => listeners.get(t)?.delete(cb),
    on: (t: string, cb: any) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(cb);
    },
  };
  const doc = new Y.Doc();
  const editor = createHeadlessEditor({
    additionalPlugins: [
      [
        YjsPlugin as any,
        {
          id: 'page',
          providerFactory: (id: string, m: Map<string, Y.Doc>) => {
            m.set(id, doc);
            return provider;
          },
          shouldBootstrap: true,
          yjsDoc: doc,
        },
      ],
    ],
  });
  provider.emit('sync', true);
  await new Promise((r) => setTimeout(r, 0));

  const seed = createHeadlessEditor();
  seed.hydrateMarkdown('# Title\n\npara one\n', { keepId: true });
  editor.hydrateEditorData(seed.export().editorData as any, { keepId: true });
  await new Promise((r) => setTimeout(r, 10));

  expect((await projectPageState(Y.encodeStateAsUpdate(doc))).markdown).toBe(
    '# Title\n\npara one\n',
  );
});
