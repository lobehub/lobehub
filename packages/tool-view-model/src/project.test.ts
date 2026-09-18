import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { projectToolViewModels } from './project';
import { listProjectedTools } from './registry';
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
  it('leaves every message untouched when no projector matches', () => {
    const messages = [toolMessage(), toolMessage({ id: 'a', role: 'assistant' })];

    expect(projectToolViewModels(messages, () => undefined)).toEqual(messages);
  });

  it('keeps the original content length after the body is dropped', () => {
    const [projected] = projectToolViewModels(
      [toolMessage()],
      resolveWith(() => ({ content: null })),
    );

    expect(projected.content).toBe('');
    expect(projected.contentLength).toBe('RAW BODY'.length);
    expect(projected.payloadOmitted).toBe(true);
  });

  it('replaces pluginState while leaving content alone', () => {
    const [projected] = projectToolViewModels(
      [toolMessage()],
      resolveWith(() => ({ pluginState: { results: [{ title: 'T' }] } })),
    );

    expect(projected.content).toBe('RAW BODY');
    expect(projected.pluginState).toEqual({ results: [{ title: 'T' }] });
    expect(projected.payloadOmitted).toBe(true);
  });

  it('does not mark a message as omitted when the projector declines', () => {
    const [projected] = projectToolViewModels(
      [toolMessage()],
      resolveWith(() => undefined),
    );

    expect(projected.payloadOmitted).toBeUndefined();
    expect(projected.pluginState).toEqual(toolMessage().pluginState);
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

    expect(compressedParent.compressedMessages![0].payloadOmitted).toBe(true);
    expect(columnParent.columns![0][0].payloadOmitted).toBe(true);
    expect(memberParent.members![0].payloadOmitted).toBe(true);
  });
});

describe('registry', () => {
  it('ships empty so this change is inert until a projector is added', () => {
    expect(listProjectedTools()).toEqual([]);
  });
});
