import type { IBlockMenuRenderContext } from '@lobehub/editor';
import { render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PageRewriteBlockMenuPlugin, {
  canRewritePageBlock,
  capturePageRewriteBlockSelection,
  createPageRewriteNodeSelection,
  handlePageRewriteBlockMenuClick,
} from './PageRewriteBlockMenuPlugin';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  findNodeById: vi.fn(),
  getNodeByKey: vi.fn(),
  resolveRewriteAdapterTarget: vi.fn(),
}));

vi.mock('@lobehub/editor', () => ({
  IBlockRewriteAdapterService: {},
  ICollaborativeTargetLeaseService: {},
  $findNodeById: mocks.findNodeById,
  hashRewriteText: (value: string) => `hash:${value}`,
  IBlockMenuService: {},
  captureCollaborativeRewriteSelection: mocks.capture,
  resolveRewriteAdapterTarget: mocks.resolveRewriteAdapterTarget,
  useLexicalEditor: vi.fn(),
}));

vi.mock('@lobehub/editor/react', () => ({ useEditor: vi.fn() }));

vi.mock('lexical', () => ({
  $getNodeByKey: mocks.getNodeByKey,
  $isDecoratorNode: (node: { decorator?: boolean }) => Boolean(node?.decorator),
  $isElementNode: (node: { element?: boolean }) => Boolean(node?.element),
  $isTextNode: (node: { text?: boolean }) => Boolean(node?.text),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const selection = {
  endNodeId: 'node-1',
  endOffset: 12,
  kind: 'block' as const,
  quotedText: 'A text block',
  quotedTextHash: 'fnv1a-test',
  startNodeId: 'node-1',
  startOffset: 0,
  targetNodeIds: ['node-1'],
};

const createContext = (text = 'A text block', editable = true) => {
  const textNode = {
    getKey: () => 'text-1',
    getTextContent: () => text,
    getTextContentSize: () => text.length,
    text: true,
  };
  const blockNode = {
    element: true,
    getAllTextNodes: () => [textNode],
    getTextContent: () => text,
  };
  mocks.getNodeByKey.mockReturnValue(blockNode);

  const editor = {
    getLexicalEditor: () => ({
      getEditorState: () => ({ read: (callback: () => void) => callback() }),
    }),
    isEditable: () => editable,
    requireService: vi.fn().mockReturnValue(null),
    blur: vi.fn(),
    setSelection: vi.fn().mockResolvedValue(true),
  };

  return {
    blockElement: document.createElement('p'),
    blockId: 'block-1',
    editor,
  } as unknown as IBlockMenuRenderContext;
};

const createLifecycleEditor = (service: unknown = null) => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const registerMenu = vi.fn(() => vi.fn());
  const editor = {
    getLexicalEditor: () => null,
    getRootElement: vi.fn(() => {
      const root = document.createElement('div');
      return root;
    }),
    isEditable: () => true,
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    }),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    }),
    requireService: vi.fn(() => service),
    emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach((listener) => listener(...args));
    },
  };
  return { editor, registerMenu };
};

describe('PageRewriteBlockMenuPlugin', () => {
  beforeEach(() => {
    mocks.capture.mockReset().mockReturnValue(selection);
    mocks.findNodeById.mockReset();
    mocks.getNodeByKey.mockReset();
    mocks.resolveRewriteAdapterTarget.mockReset().mockReturnValue(null);
  });

  it('exposes the action only for editable, non-empty text blocks', () => {
    expect(canRewritePageBlock(createContext())).toBe(true);
    expect(canRewritePageBlock(createContext('   '))).toBe(false);
    expect(canRewritePageBlock(createContext('A text block', false))).toBe(false);

    const artifactContext = createContext();
    mocks.getNodeByKey.mockReturnValue({ artifact: true, decorator: true });
    expect(canRewritePageBlock(artifactContext)).toBe(false);
  });

  it('selects the whole block, captures it, and forwards the selection', async () => {
    const context = createContext();
    const onRewriteSelection = vi.fn();

    await capturePageRewriteBlockSelection(context);
    expect(context.editor.setSelection).toHaveBeenCalledWith({
      endNodeId: 'text-1',
      endOffset: 12,
      startNodeId: 'text-1',
      startOffset: 0,
      type: 'range',
    });
    expect(mocks.capture).toHaveBeenCalledWith(context.editor);

    handlePageRewriteBlockMenuClick(context, onRewriteSelection);
    await vi.waitFor(() => expect(onRewriteSelection).toHaveBeenCalledWith(selection));
  });

  it('captures an adapter-owned child exposed by a block host as a durable node target', async () => {
    const context = createContext();
    const adapterContext = {
      adapterKey: 'artifact',
      capabilities: { canEdit: true, canMove: true, canSelect: true },
      nodeId: 'artifact-node-1',
      nodeType: 'artifact',
      source: '<main>Artifact</main>',
      sourceHash: 'hash:artifact',
      summary: 'Artifact card',
    };
    mocks.resolveRewriteAdapterTarget.mockReturnValue({
      adapter: {
        capabilities: { canEdit: true, canMove: true, canSelect: true },
        key: 'artifact',
      },
      context: adapterContext,
      node: {},
    });

    const captured = await capturePageRewriteBlockSelection(context, 'room-1');

    expect(mocks.resolveRewriteAdapterTarget).toHaveBeenCalledWith(expect.anything(), null);
    expect(context.editor.setSelection).not.toHaveBeenCalled();
    expect(captured).toMatchObject({
      adapterId: 'artifact',
      endNodeId: 'artifact-node-1',
      endOffset: 1,
      kind: 'block',
      quotedText: 'Artifact card',
      roomId: 'room-1',
      sourceHash: 'hash:artifact',
      startNodeId: 'artifact-node-1',
      startOffset: 0,
      targetKind: 'node',
      targetNodeId: 'artifact-node-1',
      targetNodeIds: ['artifact-node-1'],
    });
  });

  it('resolves a committed block-image callback by its persistent Properties id', () => {
    const context = createContext();
    const committedNode = { image: true };
    const adapterContext = {
      adapterKey: 'block-image',
      capabilities: { canEdit: true, canMove: true, canSelect: true },
      image: { placeholder: true },
      nodeId: 'image-persistent-id',
      nodeType: 'block-image',
      source: '',
      sourceHash: 'hash:image',
      summary: 'Generated image',
    };
    mocks.findNodeById.mockReturnValue(committedNode);
    mocks.resolveRewriteAdapterTarget.mockReturnValue({
      adapter: {
        capabilities: adapterContext.capabilities,
        key: 'block-image',
      },
      context: adapterContext,
      node: committedNode,
    });

    const captured = createPageRewriteNodeSelection(
      context.editor,
      'image-persistent-id',
      'room-1',
    );

    expect(mocks.findNodeById).toHaveBeenCalledWith('image-persistent-id');
    expect(captured).toMatchObject({
      adapterId: 'block-image',
      imagePlaceholder: true,
      roomId: 'room-1',
      sourceHash: 'hash:image',
      targetNodeId: 'image-persistent-id',
    });
  });

  it('clears the native selection before opening an adapter-owned node rewrite', async () => {
    const context = createContext();
    mocks.resolveRewriteAdapterTarget.mockReturnValue({
      adapter: {
        capabilities: { canEdit: true, canMove: true, canSelect: true },
        key: 'artifact',
      },
      context: {
        adapterKey: 'artifact',
        capabilities: { canEdit: true, canMove: true, canSelect: true },
        nodeId: 'artifact-node-1',
        nodeType: 'artifact',
        source: '<main>Artifact</main>',
        sourceHash: 'hash:artifact',
      },
      node: {},
    });
    const calls: string[] = [];
    (context.editor.blur as ReturnType<typeof vi.fn>).mockImplementation(() => {
      calls.push('blur');
    });
    const onRewriteSelection = vi.fn(() => {
      calls.push('open');
    });

    handlePageRewriteBlockMenuClick(context, onRewriteSelection, 'room-1');
    await vi.waitFor(() => expect(onRewriteSelection).toHaveBeenCalledOnce());

    expect(context.editor.blur).toHaveBeenCalledOnce();
    expect(calls).toEqual(['blur', 'open']);
  });

  it('does not create a node target without the explicit collaboration room', async () => {
    const context = createContext();
    mocks.resolveRewriteAdapterTarget.mockReturnValue({
      adapter: {
        capabilities: { canEdit: true, canMove: true, canSelect: true },
        key: 'artifact',
      },
      context: {
        adapterKey: 'artifact',
        capabilities: { canEdit: true, canMove: true, canSelect: true },
        nodeId: 'artifact-node-1',
        nodeType: 'artifact',
        source: '<main>Artifact</main>',
        sourceHash: 'hash:artifact',
      },
      node: {},
    });

    await expect(capturePageRewriteBlockSelection(context)).resolves.toBeNull();
  });

  it('registers after initialized when the block-menu service was unavailable at mount', async () => {
    let service: { registerMenu: ReturnType<typeof vi.fn> } | null = null;
    const lifecycle = createLifecycleEditor(null);
    lifecycle.editor.requireService.mockImplementation(() => service);
    const root = document.createElement('div');
    lifecycle.editor.getRootElement.mockReturnValue(root);

    render(
      createElement(PageRewriteBlockMenuPlugin, {
        editor: lifecycle.editor as never,
        onRewriteSelection: vi.fn(),
      }),
    );
    expect(lifecycle.editor.on).toHaveBeenCalledWith('initialized', expect.any(Function));

    service = { registerMenu: vi.fn(() => vi.fn()) };
    lifecycle.editor.emit('initialized', {});

    await waitFor(() => expect(service?.registerMenu).toHaveBeenCalledTimes(1));
    expect(root).toHaveAttribute('data-page-rewrite-block-menu', 'registered');
  });

  it('registers immediately when initialized services already exist and ignores repeated events', async () => {
    const service = { registerMenu: vi.fn(() => vi.fn()) };
    const lifecycle = createLifecycleEditor(service);
    const root = document.createElement('div');
    lifecycle.editor.getRootElement.mockReturnValue(root);

    const { unmount } = render(
      createElement(PageRewriteBlockMenuPlugin, {
        editor: lifecycle.editor as never,
        onRewriteSelection: vi.fn(),
      }),
    );
    await waitFor(() => expect(service.registerMenu).toHaveBeenCalledTimes(1));
    lifecycle.editor.emit('initialized', {});
    lifecycle.editor.emit('initialized', {});
    expect(service.registerMenu).toHaveBeenCalledTimes(1);

    const unregister = service.registerMenu.mock.results[0]?.value as ReturnType<typeof vi.fn>;
    unmount();
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(root).not.toHaveAttribute('data-page-rewrite-block-menu');
    expect(lifecycle.editor.off).toHaveBeenCalledWith('initialized', expect.any(Function));
  });
});
