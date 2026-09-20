import { LOADING_FLAT } from '@lobechat/const';
import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { projectToolViewModels } from './project';
import { getToolProjector, listProjectedTools } from './registry';
import type { ToolProjector } from './types';

const toolMessage = (partial: Partial<UIChatMessage> = {}): UIChatMessage =>
  ({
    content: 'RAW BODY',
    createdAt: 0,
    id: 'tool-1',
    plugin: { apiName: 'crawlSinglePage', arguments: '{}', identifier: 'lobe-web-browsing' },
    pluginState: { results: [{ data: { content: 'x'.repeat(5000) } }] },
    role: 'tool',
    updatedAt: 0,
    ...partial,
  }) as UIChatMessage;

const resolveWith = (projector: ToolProjector) => (identifier?: string | null) =>
  identifier === 'lobe-web-browsing' ? projector : undefined;

describe('projectToolViewModels', () => {
  it('drops the body of a tool with no projector, keeping its state whole', () => {
    const [projected] = projectToolViewModels([toolMessage()], () => undefined);

    expect(projected.content).toBe('');
    expect(projected.contentLength).toBe('RAW BODY'.length);
    expect(projected.payloadOmitted).toBe('render');
    // State drives the collapsed row and whole-list selectors, which never get
    // an "expand" to hydrate on.
    expect(projected.pluginState).toEqual(toolMessage().pluginState);
  });

  it('leaves a still-streaming row alone — the sentinel IS how it reads as running', () => {
    // `hasToolResultBody` recognises the placeholder only while it sits in
    // `content`; projecting it away would report a running tool as finished.
    const streaming = toolMessage({ content: LOADING_FLAT });

    expect(projectToolViewModels([streaming], () => undefined)[0]).toEqual(streaming);
  });

  it('does not flag an empty result, which has nothing to fetch back', () => {
    const empty = toolMessage({ content: '' });

    expect(projectToolViewModels([empty], () => undefined)[0]).toEqual(empty);
  });

  it('never touches a non-tool message', () => {
    const assistant = toolMessage({ id: 'a', role: 'assistant' });

    expect(projectToolViewModels([assistant], () => undefined)[0]).toEqual(assistant);
  });

  it('keeps the original content length after the body is dropped', () => {
    const [projected] = projectToolViewModels(
      [toolMessage()],
      resolveWith(() => ({ content: null })),
    );

    expect(projected.content).toBe('');
    expect(projected.contentLength).toBe('RAW BODY'.length);
    expect(projected.payloadOmitted).toBe('detail');
  });

  it('replaces pluginState while leaving content alone', () => {
    const [projected] = projectToolViewModels(
      [toolMessage()],
      resolveWith(() => ({ pluginState: { results: [{ title: 'T' }] } })),
    );

    expect(projected.content).toBe('RAW BODY');
    expect(projected.pluginState).toEqual({ results: [{ title: 'T' }] });
    expect(projected.payloadOmitted).toBe('detail');
  });

  it('records which surface has to fetch the stored payload back', () => {
    const [projected] = projectToolViewModels(
      [toolMessage()],
      resolveWith(() => ({ content: null, storedPayloadNeededBy: 'render' })),
    );

    expect(projected.payloadOmitted).toBe('render');
  });

  it('respects a projector that declines — it knows the shape, the default does not', () => {
    const [projected] = projectToolViewModels(
      [toolMessage()],
      resolveWith(() => undefined),
    );

    expect(projected.payloadOmitted).toBeUndefined();
    expect(projected.content).toBe('RAW BODY');
  });

  it('falls back to the stored payload when a projector throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [projected] = projectToolViewModels(
      [toolMessage()],
      resolveWith(() => {
        throw new Error('bad shape');
      }),
    );

    expect(projected).toEqual(toolMessage());
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('never projects a non-tool message, even with a plugin payload', () => {
    const assistant = toolMessage({ id: 'a', role: 'assistant' });

    const [projected] = projectToolViewModels(
      [assistant],
      resolveWith(() => ({ content: null })),
    );

    expect(projected).toEqual(assistant);
  });

  it('projects tool rows nested in compression groups, columns and members', () => {
    const nested = [
      toolMessage({ id: 'nested', compressedMessages: [toolMessage({ id: 'compressed' })] }),
      toolMessage({ id: 'col-parent', columns: [[toolMessage({ id: 'col-child' })]] }),
      toolMessage({ id: 'member-parent', members: [toolMessage({ id: 'member' })] }),
    ];

    const [compressedParent, columnParent, memberParent] = projectToolViewModels(
      nested,
      resolveWith(() => ({ content: null })),
    );

    expect(compressedParent.compressedMessages![0].payloadOmitted).toBe('detail');
    expect(columnParent.columns![0][0].payloadOmitted).toBe('detail');
    expect(memberParent.members![0].payloadOmitted).toBe('detail');
  });
});

describe('registry', () => {
  it('projects exactly the tools that were measured and audited', () => {
    expect(listProjectedTools().sort()).toEqual([
      'claude-code/Bash',
      'codex/command_execution',
      'lobe-agent-documents/listDocuments',
      'lobe-agent-documents/readDocument',
      'lobe-cloud-sandbox/grepContent',
      'lobe-local-system/grepContent',
      'lobe-local-system/readFile',
      'lobe-local-system/runCommand',
      'lobe-user-memory/searchUserMemory',
      'lobe-web-browsing/crawlMultiPages',
      'lobe-web-browsing/crawlSinglePage',
      'opencode/bash',
      'pi/bash',
    ]);
  });
});

describe('listDocumentsProjector', () => {
  const listMessage = (pluginState: unknown) =>
    toolMessage({
      content: 'RAW BODY',
      plugin: { apiName: 'listDocuments', arguments: '{}', identifier: 'lobe-agent-documents' },
      pluginState,
    } as Partial<UIChatMessage>);

  it('keeps the row count the inspector chip prints and drops the rows', () => {
    const documents = Array.from({ length: 12 }, (_, index) => ({
      filename: `doc-${index}.md`,
      id: `d${index}`,
      title: 'x'.repeat(200),
    }));

    const [projected] = projectToolViewModels([listMessage({ documents })], getToolProjector);

    expect(projected.pluginState).toEqual({ documentCount: 12 });
    expect(projected.content).toBe('');
    expect(projected.payloadOmitted).toBe('render');
  });

  it('survives a state that never held a list', () => {
    const [projected] = projectToolViewModels([listMessage({ scope: 'agent' })], getToolProjector);

    expect(projected.pluginState).toEqual({ documentCount: undefined, scope: 'agent' });
  });
});

describe('searchUserMemoryProjector', () => {
  const memoryMessage = (pluginState: unknown) =>
    toolMessage({
      content: 'RAW BODY',
      plugin: { apiName: 'searchUserMemory', arguments: '{}', identifier: 'lobe-user-memory' },
      pluginState,
    } as Partial<UIChatMessage>);

  it('reduces the five buckets to the one number the chip shows', () => {
    const [projected] = projectToolViewModels(
      [
        memoryMessage({
          activities: [{ content: 'x'.repeat(400) }, { content: 'y' }],
          contexts: [{ content: 'z' }],
          experiences: [],
          identities: [{ content: 'a' }],
          preferences: [],
        }),
      ],
      getToolProjector,
    );

    expect(projected.pluginState).toEqual({ resultCount: 4 });
    expect(projected.payloadOmitted).toBe('render');
  });

  it('reports zero for an empty search rather than dropping the state', () => {
    const [projected] = projectToolViewModels([memoryMessage({})], getToolProjector);

    expect(projected.pluginState).toEqual({ resultCount: 0 });
  });
});

describe('grepContentProjector', () => {
  const grepMessage = (pluginState: unknown, identifier = 'lobe-local-system') =>
    toolMessage({
      content: 'RAW BODY',
      plugin: { apiName: 'grepContent', arguments: '{}', identifier },
      pluginState,
    } as Partial<UIChatMessage>);

  it.each(['lobe-local-system', 'lobe-cloud-sandbox'])(
    'drops the match list on %s and leaves the count the chip reads',
    (identifier) => {
      const matches = Array.from({ length: 40 }, (_, index) => `/repo/src/file-${index}.ts`);

      const [projected] = projectToolViewModels(
        [grepMessage({ matches, pattern: 'useEffect', totalMatches: 40 }, identifier)],
        getToolProjector,
      );

      expect(projected.pluginState).toEqual({ pattern: 'useEffect', totalMatches: 40 });
      expect(projected.content).toBe('');
      expect(projected.contentLength).toBe('RAW BODY'.length);
      expect(projected.payloadOmitted).toBe('render');
    },
  );

  it('keeps a zero-match state renderable', () => {
    const [projected] = projectToolViewModels(
      [grepMessage({ matches: [], pattern: 'nothing', totalMatches: 0 })],
      getToolProjector,
    );

    expect(projected.pluginState).toEqual({ pattern: 'nothing', totalMatches: 0 });
  });
});

describe('a row that is still running', () => {
  // `hasToolResultBody` reads the sentinel to mean "no result yet". Projecting
  // it would leave content '' behind contentLength 3, which reads as finished.
  it.each([
    ['with a projector', 'lobe-local-system', 'grepContent'],
    ['with a projector that takes the no-state branch', 'lobe-local-system', 'readFile'],
    ['without one', 'some-mcp-plugin', 'doThing'],
  ])('is untouched %s', (_label, identifier, apiName) => {
    const running = toolMessage({
      content: LOADING_FLAT,
      plugin: { apiName, arguments: '{}', identifier },
      pluginState: undefined,
    } as Partial<UIChatMessage>);

    const [projected] = projectToolViewModels([running], getToolProjector);

    expect(projected).toEqual(running);
    expect(projected.content).toBe(LOADING_FLAT);
    expect(projected.contentLength).toBeUndefined();
    expect(projected.payloadOmitted).toBeUndefined();
  });

  it('still projects once the real body lands', () => {
    const [projected] = projectToolViewModels(
      [
        toolMessage({
          content: 'RAW BODY',
          plugin: { apiName: 'grepContent', arguments: '{}', identifier: 'lobe-local-system' },
          pluginState: { matches: ['/a.ts'], pattern: 'x', totalMatches: 1 },
        } as Partial<UIChatMessage>),
      ],
      getToolProjector,
    );

    expect(projected.pluginState).toEqual({ pattern: 'x', totalMatches: 1 });
    expect(projected.payloadOmitted).toBe('render');
  });
});
