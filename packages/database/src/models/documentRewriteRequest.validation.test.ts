// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  collectAIBlockSessionProjection,
  collectAISessionProjection,
  normalizeRewriteText,
  normalizeSelection,
  resolvePersistedBlockRewriteContext,
} from './documentRewriteRequest.validation';

const sessionNode = (sessionId: string, text: string) => ({
  $: { properties: { provenance: { sessionId, source: 'ai' } } },
  text,
  type: 'text',
});

describe('collectAISessionProjection', () => {
  it('reconstructs marked text in persisted editor order', () => {
    const projection = collectAISessionProjection(
      {
        root: {
          children: [sessionNode('session-1', 'A concise '), sessionNode('session-1', 'result')],
        },
      },
      'session-1',
    );

    expect(projection).toEqual({ rangeCount: 2, text: 'A concise result' });
    expect(normalizeRewriteText(projection.text)).toBe('A concise result');
  });

  it('returns an empty projection when the session provenance was deleted', () => {
    expect(
      collectAISessionProjection(
        { root: { children: [sessionNode('other-session', 'A concise result')] } },
        'session-1',
      ),
    ).toEqual({ rangeCount: 0, text: '' });
  });

  it('preserves changed persisted text for the continuation comparator', () => {
    const projection = collectAISessionProjection(
      { root: { children: [sessionNode('session-1', 'A different sentence.')] } },
      'session-1',
    );

    expect(projection.rangeCount).toBe(1);
    expect(normalizeRewriteText(projection.text)).not.toBe('A concise result');
  });

  it('refreshes current list-item target ids while excluding cursor sentinels', () => {
    const projection = collectAISessionProjection(
      {
        root: {
          children: [
            {
              $: { properties: { nodeId: 'old-list', provenance: undefined } },
              children: [
                {
                  $: { properties: { nodeId: 'item-a' } },
                  children: [
                    sessionNode('session-list', '甲：调用 '),
                    {
                      $: {
                        properties: { provenance: { sessionId: 'session-list', source: 'ai' } },
                      },
                      text: '\uFEFF',
                      type: 'cursor',
                    },
                    sessionNode('session-list', 'sort。'),
                  ],
                  type: 'listitem',
                },
                {
                  $: { properties: { nodeId: 'item-b' } },
                  children: [sessionNode('session-list', '乙：保留原文。')],
                  type: 'listitem',
                },
                {
                  $: { properties: { nodeId: 'item-c' } },
                  children: [sessionNode('session-list', '丙：高亮随滚动。')],
                  type: 'listitem',
                },
              ],
              type: 'list',
            },
          ],
        },
      },
      'session-list',
    );

    expect(projection.targetNodeIds).toEqual(['item-a', 'item-b', 'item-c']);
    expect(projection.text).toBe('甲：调用 sort。乙：保留原文。丙：高亮随滚动。');
  });
});

describe('collectAIBlockSessionProjection', () => {
  it('reads provenance stamped on an Artifact node rather than its absent text field', () => {
    expect(
      collectAIBlockSessionProjection(
        {
          root: {
            children: [
              {
                $: {
                  properties: {
                    nodeId: 'artifact-1',
                    provenance: { sessionId: 'session-1', source: 'ai' },
                  },
                },
                html: '<main>Applied artifact</main>',
                title: 'Artifact',
                type: 'artifact',
              },
            ],
          },
        },
        'session-1',
        'artifact-1',
      ),
    ).toEqual({
      nodeCount: 1,
      rangeCount: 1,
      text: '<main>Applied artifact</main>',
    });
  });

  it('reconstructs a code node from serialized children and distinguishes missing nodes', () => {
    const editorData = {
      root: {
        children: [
          {
            $: {
              properties: {
                nodeId: 'code-1',
                provenance: { sessionId: 'session-1', source: 'ai' },
              },
            },
            children: [
              { text: 'const value = 1;', type: 'text' },
              { type: 'linebreak' },
              { text: 'return value;', type: 'text' },
            ],
            type: 'code',
          },
        ],
      },
    };
    expect(collectAIBlockSessionProjection(editorData, 'session-1', 'code-1')).toMatchObject({
      nodeCount: 1,
      text: 'const value = 1;\nreturn value;',
    });
    expect(collectAIBlockSessionProjection(editorData, 'session-1', 'other')).toEqual({
      nodeCount: 0,
      rangeCount: 0,
      text: '',
    });
  });
});

describe('resolvePersistedBlockRewriteContext', () => {
  it('resolves the current source and summary for each supported node adapter', () => {
    const editorData = {
      root: {
        children: [
          {
            $: {
              properties: {
                nodeId: 'artifact-1',
                provenance: { sessionId: 'session-1', source: 'ai' },
              },
            },
            html: '<main>Current artifact</main>',
            title: 'Current artifact',
            type: 'artifact',
          },
          {
            $: {
              properties: {
                nodeId: 'code-mirror-1',
                provenance: { sessionId: 'session-1', source: 'ai' },
              },
            },
            code: 'const current = true;',
            language: 'typescript',
            type: 'code',
          },
          {
            $: {
              properties: {
                nodeId: 'code-block-1',
                provenance: { sessionId: 'session-1', source: 'ai' },
              },
            },
            children: [
              { text: 'const current = true;', type: 'text' },
              { type: 'linebreak' },
              { text: 'return current;', type: 'text' },
            ],
            language: 'javascript',
            type: 'code',
          },
          {
            $: {
              properties: {
                nodeId: 'link-1',
                provenance: { sessionId: 'session-1', source: 'ai' },
              },
            },
            description: 'A current link',
            title: 'Current link',
            type: 'link-block-card',
            url: 'https://example.com/current',
          },
          {
            $: {
              properties: {
                nodeId: 'image-1',
                provenance: { sessionId: 'session-1', source: 'ai' },
              },
            },
            altText: 'Current image',
            height: 768,
            maxWidth: null,
            src: '/f/image-1',
            status: 'uploaded',
            type: 'block-image',
            width: 1024,
          },
        ],
      },
    };

    expect(
      resolvePersistedBlockRewriteContext(editorData, 'session-1', 'artifact-1', 'artifact'),
    ).toMatchObject({
      context: {
        quotedText: 'Current artifact',
        source: '<main>Current artifact</main>',
        sourceHash: expect.stringMatching(/^fnv1a-/),
      },
      status: 'found',
    });
    expect(
      resolvePersistedBlockRewriteContext(editorData, 'session-1', 'code-mirror-1', 'codemirror'),
    ).toMatchObject({
      context: { quotedText: 'Code (typescript)', source: 'const current = true;' },
      status: 'found',
    });
    expect(
      resolvePersistedBlockRewriteContext(editorData, 'session-1', 'code-block-1', 'codeblock'),
    ).toMatchObject({
      context: {
        quotedText: 'Code block (javascript)',
        source: 'const current = true;\nreturn current;',
      },
      status: 'found',
    });
    expect(
      resolvePersistedBlockRewriteContext(editorData, 'session-1', 'link-1', 'link-block-card'),
    ).toMatchObject({
      context: {
        quotedText: 'A current link',
        source: JSON.stringify({
          description: 'A current link',
          title: 'Current link',
          url: 'https://example.com/current',
        }),
      },
      status: 'found',
    });
    expect(
      resolvePersistedBlockRewriteContext(editorData, 'session-1', 'image-1', 'block-image'),
    ).toMatchObject({
      context: {
        quotedText: 'Current image',
        source: JSON.stringify({
          altText: 'Current image',
          height: 768,
          maxWidth: null,
          placeholder: false,
          src: '/f/image-1',
          width: 1024,
        }),
      },
      status: 'found',
    });
  });

  it('distinguishes deleted nodes from adapter identity drift', () => {
    const editorData = {
      root: {
        children: [
          {
            $: { properties: { nodeId: 'node-1', provenance: { sessionId: 'session-1' } } },
            html: '<main>source</main>',
            type: 'artifact',
          },
        ],
      },
    };

    expect(
      resolvePersistedBlockRewriteContext(editorData, 'session-1', 'missing', 'artifact'),
    ).toEqual({ status: 'missing' });
    expect(
      resolvePersistedBlockRewriteContext(editorData, 'session-1', 'node-1', 'codeblock'),
    ).toEqual({ status: 'adapter-mismatch' });
  });
});

describe('normalizeSelection', () => {
  const nodeSelection = (overrides: Record<string, unknown> = {}) => ({
    adapterId: 'artifact',
    kind: 'block',
    quotedText: 'Artifact preview',
    quotedTextHash: 'hash:preview',
    roomId: 'room-node-selection',
    sourceHash: 'hash:source',
    targetKind: 'node',
    targetNodeId: 'artifact-node-1',
    targetNodeIds: ['artifact-node-1'],
    ...overrides,
  });

  it('normalizes an adapter-owned node target to one durable node range', () => {
    expect(normalizeSelection(nodeSelection())).toMatchObject({
      adapterId: 'artifact',
      endNodeId: 'artifact-node-1',
      endOffset: 1,
      sourceHash: 'hash:source',
      startNodeId: 'artifact-node-1',
      startOffset: 0,
      targetKind: 'node',
      targetNodeId: 'artifact-node-1',
      targetNodeIds: ['artifact-node-1'],
    });
  });

  it('rejects node targets without adapter/source proof or with multiple nodes', () => {
    expect(() => normalizeSelection(nodeSelection({ adapterId: null }))).toThrow(
      'selection.adapterId',
    );
    expect(() => normalizeSelection(nodeSelection({ roomId: null }))).toThrow('selection.roomId');
    expect(() => normalizeSelection(nodeSelection({ sourceHash: null }))).toThrow(
      'selection.sourceHash',
    );
    expect(() =>
      normalizeSelection(nodeSelection({ targetNodeIds: ['artifact-node-1', 'artifact-node-2'] })),
    ).toThrow('selection.targetNodeIds');
    expect(() => normalizeSelection(nodeSelection({ kind: 'relative' }))).toThrow(
      'selection.targetKind',
    );
  });
});
