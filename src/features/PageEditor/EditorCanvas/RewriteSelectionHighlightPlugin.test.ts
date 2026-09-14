/**
 * @vitest-environment happy-dom
 */
import { $setNodeId, hashRewriteText, IAISessionService, type IEditor } from '@lobehub/editor';
import { render, waitFor } from '@testing-library/react';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  DecoratorNode,
} from 'lexical';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import RewriteSelectionHighlightPlugin, {
  getRewriteSelectionIdentity,
  mergeOverlayRects,
  resolveAISessionDOMRanges,
} from './RewriteSelectionHighlightPlugin';

const rect = (values: Partial<DOMRect>): DOMRect =>
  ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    ...values,
  }) as DOMRect;

const selection = (capturedAt: string) => ({
  capturedAt,
  endNodeId: 'node-2',
  endOffset: 8,
  kind: 'relative' as const,
  quotedText: 'Selected text',
  quotedTextHash: 'hash:selected',
  roomId: 'page-1',
  startNodeId: 'node-1',
  startOffset: 0,
  targetNodeIds: ['node-1', 'node-2'],
});

describe('RewriteSelectionHighlightPlugin projections', () => {
  it.each(['draft', 'continuation'])(
    'marks only the atomic card for a %s and clears it on close',
    async (mode) => {
      class Card extends DecoratorNode<null> {
        static getType() {
          return 'test-rewrite-card';
        }
        static clone(node: Card) {
          return new Card(node.__key);
        }
        createDOM() {
          return document.createElement('div');
        }
        updateDOM() {
          return false;
        }
        decorate() {
          return null;
        }
      }
      const root = document.createElement('div');
      document.body.append(root);
      const lexicalEditor = createEditor({ namespace: 'atomic-highlight', nodes: [Card] });
      lexicalEditor.setRootElement(root);
      let key = '';
      lexicalEditor.update(
        () => {
          const card = new Card();
          $setNodeId(card, 'card-1');
          key = card.getKey();
          $getRoot().append(
            $createParagraphNode().append($createTextNode('Before')),
            card,
            $createParagraphNode().append($createTextNode('After')),
          );
        },
        { discrete: true },
      );
      const getRanges = vi.fn(() => []);
      const editor = {
        getLexicalEditor: () => lexicalEditor,
        getRootElement: () => root,
        requireService: () => ({ getRanges, subscribe: () => () => {} }),
      } as unknown as IEditor;
      const selected = {
        kind: 'block' as const,
        targetKind: 'node',
        targetNodeId: 'card-1',
        startNodeId: 'card-1',
        endNodeId: 'card-1',
        startOffset: 0,
        endOffset: 1,
        quotedText: 'Code (javascript)',
        quotedTextHash: 'hash:code',
        targetNodeIds: ['card-1'],
      };
      const view = render(
        createElement(RewriteSelectionHighlightPlugin, {
          editor,
          ...(mode === 'draft'
            ? { selection: selected as never }
            : { continuationTarget: { selection: selected, sessionId: 'old-session' } }),
        }),
      );
      const card = lexicalEditor.getElementByKey(key)!;
      await waitFor(() => expect(card).toHaveAttribute('data-page-rewrite-block-selected', 'true'));
      expect(root.querySelectorAll('[data-page-rewrite-block-selected]')).toHaveLength(1);
      expect(root.querySelectorAll('p[data-page-rewrite-block-selected]')).toHaveLength(0);
      expect(document.querySelectorAll('[data-page-rewrite-selection-overlay]')).toHaveLength(0);
      expect(getRanges).not.toHaveBeenCalled();
      view.rerender(createElement(RewriteSelectionHighlightPlugin, { editor }));
      await waitFor(() => expect(card).not.toHaveAttribute('data-page-rewrite-block-selected'));
      view.unmount();
      lexicalEditor.setRootElement(null);
      root.remove();
    },
  );
  it('deduplicates the composer and server row for the same durable range', () => {
    expect(getRewriteSelectionIdentity(selection('first'))).toBe(
      getRewriteSelectionIdentity(selection('same-range-after-submit')),
    );
  });

  it('merges overlay rects from adjacent active ranges', () => {
    expect(
      mergeOverlayRects([
        rect({ bottom: 18, left: 10, right: 80, top: 0, height: 18, width: 70 }),
        rect({ bottom: 36, left: 10, right: 90, top: 18, height: 18, width: 80 }),
        rect({ bottom: 18, left: 140, right: 180, top: 0, height: 18, width: 40 }),
      ]),
    ).toEqual([
      { bottom: 36, left: 10, right: 90, top: 0 },
      { bottom: 18, left: 140, right: 180, top: 0 },
    ]);
  });

  it('uses a visible overlay for an applied-session Continue target', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const lexicalEditor = createEditor({ namespace: 'rewrite-highlight-test' });
    lexicalEditor.setRootElement(root);
    let textKey = '';
    lexicalEditor.update(() => {
      const paragraph = $createParagraphNode();
      const text = $createTextNode('A concise result');
      textKey = text.getKey();
      paragraph.append(text);
      $getRoot().append(paragraph);
    });

    const registry = new Map<string, unknown>([['ai-session-active', {}]]);
    const highlightConstructor = class {
      ranges: Range[];

      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    };
    const originalCSS = window.CSS;
    const originalHighlight = window.Highlight;
    Object.defineProperty(window, 'CSS', {
      configurable: true,
      value: { ...(originalCSS as object), highlights: registry },
    });
    Object.defineProperty(window, 'Highlight', {
      configurable: true,
      value: highlightConstructor,
    });
    const rangeRects = [
      {
        bottom: 40,
        height: 20,
        left: 10,
        right: 180,
        top: 20,
        width: 170,
      },
    ] as unknown as DOMRect[];
    const getClientRects = vi
      .spyOn(Range.prototype, 'getClientRects')
      .mockReturnValue(rangeRects as unknown as DOMRectList);

    const service = {
      // Simulate the strong-refresh gap: DOM is present but the service cache
      // has not rebuilt its ranges yet.
      getRanges: () => [],
      subscribe: (listener: () => void) => {
        void listener;
        return () => {};
      },
    };
    const editor = {
      getLexicalEditor: () => lexicalEditor,
      getRootElement: () => root,
      requireService: (serviceId: unknown) => (serviceId === IAISessionService ? service : null),
    } as unknown as IEditor;

    const view = render(
      createElement(RewriteSelectionHighlightPlugin, {
        editor,
      }),
    );
    expect(registry.has('page-rewrite-selection')).toBe(false);

    await waitFor(() => expect(lexicalEditor.getElementByKey(textKey)).not.toBeNull());
    const hydratedTextElement = lexicalEditor.getElementByKey(textKey);
    expect(hydratedTextElement).not.toBeNull();
    hydratedTextElement!.dataset.aiSessionId = 'session-1';
    expect(resolveAISessionDOMRanges(editor, 'session-1')[0]?.toString()).toBe('A concise result');

    view.rerender(
      createElement(RewriteSelectionHighlightPlugin, {
        continuationTarget: {
          outputText: 'A concise result',
          requestId: 'request-1',
          selection: {
            endNodeId: 'node-1',
            endOffset: 16,
            kind: 'block',
            quotedText: 'A concise result',
            quotedTextHash: 'hash',
            startNodeId: 'node-1',
            startOffset: 0,
          },
          sessionId: 'session-1',
        },
        editor,
      }),
    );

    await waitFor(() =>
      expect(document.querySelectorAll('[data-page-rewrite-selection-overlay]')).toHaveLength(1),
    );
    expect(root).toHaveAttribute('data-page-rewrite-selection-highlight', 'overlay');
    expect(document.querySelector('[data-page-rewrite-selection-overlay]')).toHaveStyle({
      height: '20px',
      left: '10px',
      top: '20px',
      width: '170px',
    });
    expect(registry.has('page-rewrite-selection')).toBe(false);
    expect(registry.has('ai-session-active')).toBe(true);

    // The browser can lose CSS Custom Highlight support while the editor
    // remains mounted. A continuation must stay visible through that change.
    Object.defineProperty(window, 'CSS', {
      configurable: true,
      value: { ...(originalCSS as object) },
    });
    window.dispatchEvent(new Event('scroll'));
    await waitFor(() =>
      expect(document.querySelectorAll('[data-page-rewrite-selection-overlay]')).toHaveLength(1),
    );

    view.rerender(createElement(RewriteSelectionHighlightPlugin, { editor }));
    await waitFor(() => expect(registry.has('page-rewrite-selection')).toBe(false));
    expect(document.querySelectorAll('[data-page-rewrite-selection-overlay]')).toHaveLength(0);
    expect(registry.has('ai-session-active')).toBe(true);
    view.unmount();
    getClientRects.mockRestore();
    Object.defineProperty(window, 'CSS', {
      configurable: true,
      value: originalCSS,
    });
    Object.defineProperty(window, 'Highlight', {
      configurable: true,
      value: originalHighlight,
    });
    root.remove();
  });

  it('anchors fallback overlays to the editor host across nested scroll and zoom', async () => {
    const originalBodyTransform = document.body.style.transform;
    // A transformed body establishes a containing block for fixed descendants;
    // the overlay must remain in the editor host's coordinate space instead.
    document.body.style.transform = 'scale(2)';
    const scroller = document.createElement('div');
    scroller.style.position = 'relative';
    scroller.dataset.pageEditorScrollContainer = '';
    const staticParent = document.createElement('div');
    const root = document.createElement('div');
    const marked = document.createElement('span');
    marked.dataset.aiSessionId = 'session-scroll';
    marked.textContent = 'Generated text';
    root.append(marked);
    staticParent.append(root);
    scroller.append(staticParent);
    document.body.append(scroller);

    Object.defineProperties(scroller, {
      getBoundingClientRect: {
        configurable: true,
        value: () => ({
          bottom: 250,
          height: 200,
          left: 10,
          right: 410,
          top: 50,
          width: 400,
        }),
      },
      clientLeft: { configurable: true, value: 3 },
      clientHeight: { configurable: true, value: 100 },
      clientTop: { configurable: true, value: 4 },
      clientWidth: { configurable: true, value: 200 },
      offsetHeight: { configurable: true, value: 100 },
      offsetWidth: { configurable: true, value: 200 },
      scrollLeft: { configurable: true, value: 7 },
      scrollTop: { configurable: true, value: 12 },
    });

    let rangeRect = {
      bottom: 120,
      height: 20,
      left: 30,
      right: 230,
      top: 100,
      width: 200,
    } as unknown as DOMRect;
    const getClientRects = vi
      .spyOn(Range.prototype, 'getClientRects')
      .mockImplementation(() => [rangeRect] as unknown as DOMRectList);
    const service = {
      getRanges: () => [],
      subscribe: (listener: () => void) => {
        void listener;
        return () => {};
      },
    };
    const editor = {
      getRootElement: () => root,
      requireService: (serviceId: unknown) => (serviceId === IAISessionService ? service : null),
    } as unknown as IEditor;

    const view = render(
      createElement(RewriteSelectionHighlightPlugin, {
        continuationTarget: {
          outputText: 'Generated text',
          requestId: 'request-scroll',
          sessionId: 'session-scroll',
        },
        editor,
      }),
    );

    await waitFor(() =>
      expect(scroller.querySelectorAll('[data-page-rewrite-selection-overlay]')).toHaveLength(1),
    );
    const overlay = () =>
      scroller.querySelector<HTMLElement>('[data-page-rewrite-selection-overlay]');
    expect(overlay()).toHaveStyle({
      height: '10px',
      left: '14px',
      position: 'absolute',
      top: '33px',
      width: '100px',
    });
    expect(document.body.querySelectorAll('[data-page-rewrite-selection-overlay]')).toHaveLength(1);

    rangeRect = { ...rangeRect, bottom: 140, top: 120 } as DOMRect;
    window.dispatchEvent(new Event('resize'));
    await waitFor(() => expect(overlay()).toHaveStyle({ top: '43px' }));

    // A nested scroll changes both viewport rects by the same amount. The
    // absolute host keeps the overlay in the editor's local coordinate space,
    // while the direct listener still refreshes when the scroller changes.
    rangeRect = { ...rangeRect, bottom: 80, top: 60 } as DOMRect;
    Object.defineProperty(scroller, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 210,
        height: 200,
        left: 10,
        right: 410,
        top: 10,
        width: 400,
      }),
    });
    scroller.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(overlay()).toHaveStyle({ top: '33px' }));

    view.unmount();
    getClientRects.mockRestore();
    scroller.remove();
    document.body.style.transform = originalBodyTransform;
  });

  it('binds page scroll listeners when the Lexical root mounts after the plugin', async () => {
    const host = document.createElement('div');
    host.style.position = 'relative';
    const root = document.createElement('div');
    const marked = document.createElement('span');
    marked.dataset.aiSessionId = 'session-late-root';
    marked.textContent = 'Generated text';
    root.append(marked);
    host.append(root);
    document.body.append(host);
    Object.defineProperty(host, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 250,
        height: 200,
        left: 10,
        right: 210,
        top: 50,
        width: 200,
      }),
    });

    let rangeRect = {
      bottom: 120,
      height: 20,
      left: 30,
      right: 130,
      top: 100,
      width: 100,
    } as unknown as DOMRect;
    const getClientRects = vi
      .spyOn(Range.prototype, 'getClientRects')
      .mockImplementation(() => [rangeRect] as unknown as DOMRectList);
    const service = {
      getRanges: () => [],
      subscribe: (listener: () => void) => {
        void listener;
        return () => {};
      },
    };
    let mountedRoot: HTMLElement | null = null;
    let rootListener: ((nextRoot: HTMLElement | null) => void) | undefined;
    const lexicalEditor = {
      registerRootListener: (listener: (nextRoot: HTMLElement | null) => void) => {
        rootListener = listener;
        return () => {
          rootListener = undefined;
        };
      },
      registerUpdateListener: () => () => {},
    };
    const editor = {
      getLexicalEditor: () => lexicalEditor,
      getRootElement: () => mountedRoot,
      requireService: (serviceId: unknown) => (serviceId === IAISessionService ? service : null),
    } as unknown as IEditor;

    const view = render(
      createElement(RewriteSelectionHighlightPlugin, {
        continuationTarget: {
          outputText: 'Generated text',
          requestId: 'request-late-root',
          sessionId: 'session-late-root',
        },
        editor,
      }),
    );

    expect(rootListener).toBeTypeOf('function');
    mountedRoot = root;
    rootListener?.(root);
    await waitFor(() =>
      expect(host.querySelectorAll('[data-page-rewrite-selection-overlay]')).toHaveLength(1),
    );
    const overlay = () => host.querySelector<HTMLElement>('[data-page-rewrite-selection-overlay]');
    expect(overlay()).toHaveStyle({ top: '50px' });

    // The initial effect had no ownerWindow. A later page scroll must still
    // schedule a refresh once the root has mounted.
    rangeRect = { ...rangeRect, bottom: 160, top: 140 } as DOMRect;
    window.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(overlay()).toHaveStyle({ top: '90px' }));

    view.unmount();
    getClientRects.mockRestore();
    host.remove();
  });

  it('clips a body-hosted overlay to a nested overflow viewport', async () => {
    const scroller = document.createElement('div');
    scroller.style.overflow = 'auto';
    const staticParent = document.createElement('div');
    const root = document.createElement('div');
    const marked = document.createElement('span');
    marked.dataset.aiSessionId = 'session-clip';
    marked.textContent = 'Generated text';
    scroller.append(marked);
    root.append(scroller);
    staticParent.append(root);
    document.body.append(staticParent);

    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 120 },
      clientWidth: { configurable: true, value: 200 },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({
          bottom: 220,
          height: 120,
          left: 100,
          right: 300,
          top: 100,
          width: 200,
        }),
      },
      offsetHeight: { configurable: true, value: 120 },
      offsetWidth: { configurable: true, value: 200 },
    });

    const getClientRects = vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([
      {
        bottom: 260,
        height: 170,
        left: 80,
        right: 360,
        top: 90,
        width: 280,
      } as unknown as DOMRect,
    ] as unknown as DOMRectList);
    const service = {
      getRanges: () => [],
      subscribe: (listener: () => void) => {
        void listener;
        return () => {};
      },
    };
    const editor = {
      getRootElement: () => root,
      requireService: (serviceId: unknown) => (serviceId === IAISessionService ? service : null),
    } as unknown as IEditor;

    const view = render(
      createElement(RewriteSelectionHighlightPlugin, {
        continuationTarget: {
          outputText: 'Generated text',
          requestId: 'request-clip',
          sessionId: 'session-clip',
        },
        editor,
      }),
    );

    await waitFor(() =>
      expect(document.body.querySelectorAll('[data-page-rewrite-selection-overlay]')).toHaveLength(
        1,
      ),
    );
    const overlay = document.body.querySelector<HTMLElement>(
      '[data-page-rewrite-selection-overlay]',
    );
    expect(scroller.querySelector('[data-page-rewrite-selection-overlay]')).toBeNull();
    expect(overlay).toHaveStyle({
      height: '120px',
      left: '100px',
      top: '100px',
      width: '200px',
    });

    view.unmount();
    getClientRects.mockRestore();
    scroller.remove();
  });

  it('does not project a writing node target into provenance or its following sibling', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const lexicalEditor = createEditor({ namespace: 'rewrite-highlight-node-test' });
    lexicalEditor.setRootElement(root);
    let nodeKey = '';
    let siblingKey = '';
    lexicalEditor.update(() => {
      const node = $createParagraphNode();
      const nodeText = $createTextNode('First node');
      nodeKey = node.getKey();
      node.append(nodeText);

      const sibling = $createParagraphNode();
      siblingKey = sibling.getKey();
      sibling.append($createTextNode('Following sibling'));
      $getRoot().append(node, sibling);
    });

    const registry = new Map<string, unknown>();
    const highlightConstructor = class {
      constructor(..._ranges: Range[]) {}
    };
    const originalCSS = window.CSS;
    const originalHighlight = window.Highlight;
    Object.defineProperty(window, 'CSS', {
      configurable: true,
      value: { ...(originalCSS as object), highlights: registry },
    });
    Object.defineProperty(window, 'Highlight', {
      configurable: true,
      value: highlightConstructor,
    });

    const getRanges = vi.fn(() => [{ endOffset: 10, nodeKey, startOffset: 0 }]);
    const service = {
      getRanges,
      subscribe: (listener: () => void) => {
        void listener;
        return () => {};
      },
    };
    const editor = {
      getLexicalEditor: () => lexicalEditor,
      getRootElement: () => root,
      requireService: (serviceId: unknown) => (serviceId === IAISessionService ? service : null),
    } as unknown as IEditor;

    const view = render(
      createElement(RewriteSelectionHighlightPlugin, {
        editor,
        selections: [
          {
            selection: {
              endNodeId: nodeKey,
              endOffset: 10,
              kind: 'block',
              quotedText: 'First node',
              quotedTextHash: 'hash:first-node',
              startNodeId: nodeKey,
              startOffset: 0,
              targetKind: 'node',
              targetNodeId: 'durable-node-1',
              targetNodeIds: ['durable-node-1'],
            },
            sessionId: 'session-node',
            status: 'writing',
          },
        ],
      }),
    );

    await waitFor(() => expect(getRanges).not.toHaveBeenCalled());
    expect(registry.has('page-rewrite-selection')).toBe(false);
    expect(document.querySelectorAll('[data-page-rewrite-selection-overlay]')).toHaveLength(0);
    expect(lexicalEditor.getElementByKey(siblingKey)).toHaveTextContent('Following sibling');

    view.unmount();
    Object.defineProperty(window, 'CSS', {
      configurable: true,
      value: originalCSS,
    });
    Object.defineProperty(window, 'Highlight', {
      configurable: true,
      value: originalHighlight,
    });
    root.remove();
  });

  it('continues to highlight a text-range target', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const lexicalEditor = createEditor({ namespace: 'rewrite-highlight-text-test' });
    lexicalEditor.setRootElement(root);
    lexicalEditor.update(() => {
      const paragraph = $createParagraphNode();
      const text = $createTextNode('Selected text');
      $setNodeId(paragraph, 'durable-text-block');
      paragraph.append(text);
      $getRoot().append(paragraph);
    });

    const registry = new Map<string, unknown>();
    const highlightConstructor = class {
      ranges: Range[];

      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    };
    const originalCSS = window.CSS;
    const originalHighlight = window.Highlight;
    Object.defineProperty(window, 'CSS', {
      configurable: true,
      value: { ...(originalCSS as object), highlights: registry },
    });
    Object.defineProperty(window, 'Highlight', {
      configurable: true,
      value: highlightConstructor,
    });
    const service = {
      getRanges: () => [],
      subscribe: (listener: () => void) => {
        void listener;
        return () => {};
      },
    };
    const editor = {
      getLexicalEditor: () => lexicalEditor,
      getRootElement: () => root,
      requireService: (serviceId: unknown) => (serviceId === IAISessionService ? service : null),
    } as unknown as IEditor;

    const view = render(
      createElement(RewriteSelectionHighlightPlugin, {
        editor,
        selections: [
          {
            selection: {
              endNodeId: 'durable-text-block',
              endOffset: 13,
              kind: 'block',
              quotedText: 'Selected text',
              quotedTextHash: hashRewriteText('Selected text'),
              startNodeId: 'durable-text-block',
              startOffset: 0,
              targetNodeIds: ['durable-text-block'],
            },
          },
        ],
      }),
    );

    await waitFor(() => expect(registry.has('page-rewrite-selection')).toBe(true));
    const highlight = registry.get('page-rewrite-selection') as {
      ranges: Range[];
    };
    expect(highlight.ranges).toHaveLength(1);
    expect(highlight.ranges[0]?.toString()).toBe('Selected text');

    view.unmount();
    Object.defineProperty(window, 'CSS', {
      configurable: true,
      value: originalCSS,
    });
    Object.defineProperty(window, 'Highlight', {
      configurable: true,
      value: originalHighlight,
    });
    root.remove();
  });
});
