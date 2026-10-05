import { createHeadlessEditor, type HeadlessEditor } from '@lobehub/editor/headless';
import type { SerializedEditorState, SerializedLexicalNode } from 'lexical';
import * as Y from 'yjs';

import { loadEditorYjs } from './editorYjs';

type SerializedEditor = SerializedEditorState<SerializedLexicalNode>;

type Listener = (...args: any[]) => void;

const createForkProvider = () => {
  const listeners = new Map<string, Set<Listener>>();
  let localState: any = null;
  const emit = (type: string, ...args: any[]) => listeners.get(type)?.forEach((cb) => cb(...args));

  return {
    awareness: {
      getLocalState: () => localState,
      getStates: () => new Map(),
      off: () => {},
      on: () => {},
      setLocalState: (state: any) => {
        localState = state;
      },
      setLocalStateField: (field: string, value: unknown) => {
        localState = { ...localState, [field]: value };
      },
    },
    connect: () => {
      queueMicrotask(() => {
        emit('status', { status: 'connected' });
        emit('sync', true);
      });
    },
    disconnect: () => {},
    off: (type: string, cb: Listener) => listeners.get(type)?.delete(cb),
    on: (type: string, cb: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    },
  };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

export interface PageFork {
  destroy: () => void;
  diff: () => Uint8Array;
  doc: Y.Doc;
  editor: HeadlessEditor;
  hasChanges: () => boolean;
  stableIds: () => Map<string, string>;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

// Edits run on a detached copy and only the resulting Yjs update reaches the
// room: applying LiteXML while remote updates land mid-operation corrupts the binding.
export const openPageFork = async (
  state: Uint8Array | undefined,
  bootstrapFrom?: SerializedEditor | null,
): Promise<PageFork> => {
  const { IYjsService, YjsPlugin } = await loadEditorYjs();
  const doc = new Y.Doc();
  if (state && state.length > 0) Y.applyUpdate(doc, state);
  const baseVector = Y.encodeStateVector(doc);
  const joining = !bootstrapFrom;

  const editor = createHeadlessEditor({
    additionalPlugins: [
      [
        YjsPlugin,
        {
          id: 'page',
          providerFactory: (id: string, docMap: Map<string, Y.Doc>) => {
            docMap.set(id, doc);
            const provider = createForkProvider();
            if (joining) provider.connect();
            return provider as any;
          },
          shouldBootstrap: true,
          yjsDoc: doc,
        },
      ],
    ],
  });

  // Upstream double-writes the bootstrap when `initialEditorState` is passed;
  // hydrating first lets the plugin bootstrap exactly once on sync.
  if (bootstrapFrom) editor.hydrateEditorData(bootstrapFrom, { keepId: true });
  await settle();
  await settle();

  return {
    destroy: () => editor.destroy(),
    diff: () => Y.encodeStateAsUpdate(doc, baseVector),
    doc,
    editor,
    hasChanges: () => !sameBytes(Y.encodeStateVector(doc), baseVector),
    stableIds: () => collectStableIds(editor, IYjsService),
  };
};

// Mirrors the unexported `idToChar` in @lobehub/editor's LiteXML plugin.
const liteXMLIdOf = (nodeKey: string) =>
  ((Number(nodeKey) * 7211 + 1e6) % 1_679_616).toString(36).padStart(4, '0');

// LiteXML id → an id from the node's Yjs item, identical in every fork of the room.
const collectStableIds = (editor: HeadlessEditor, yjsService: any) => {
  const state = (editor.kernel.requireService(yjsService) as any)?.getState();
  const ids = new Map<string, string>();
  if (!state) return ids;

  for (const [key, node] of state.binding.collabNodeMap as Map<string, any>) {
    const shared = node._xmlText ?? node._map ?? node._xmlElem;
    const itemId = shared?._item?.id as { client: number; clock: number } | undefined;
    if (itemId) {
      ids.set(liteXMLIdOf(key), `${itemId.client.toString(36)}_${itemId.clock.toString(36)}`);
    }
  }
  return ids;
};

export const projectPageState = async (state: Uint8Array) => {
  const fork = await openPageFork(state);
  try {
    const title = fork.doc.getMap('meta').get('title');
    return { ...fork.editor.export(), title: typeof title === 'string' ? title : undefined };
  } finally {
    fork.destroy();
  }
};
