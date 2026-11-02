import { hashContent } from '@lobechat/context-engine/onDemand';
import { type OnDemandContextCandidate, type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { serverMessagesEngine } from './index';

const message = (content: string, id: string): UIChatMessage =>
  ({
    content,
    createdAt: 1,
    id,
    role: 'user',
    updatedAt: 1,
  }) as UIChatMessage;

const memoryCandidate: OnDemandContextCandidate = {
  approval: { state: 'approved' },
  authority: 'memory',
  content: 'server current message deployment preference',
  contentHash: hashContent('server current message deployment preference'),
  id: 'memory-1',
  relevance: 1,
  scope: {
    ownerUserId: 'user-1',
    share: 'personal',
    shareGate: 'allowed',
  },
  source: { id: 'memory-1', type: 'memory' },
};

describe('serverMessagesEngine on-demand contract', () => {
  it('preserves the raw system role in the trace-facing output and returns shared metadata', async () => {
    const systemRole = '  Server Agent Prompt\nkeep exactly  ';
    const result = await serverMessagesEngine({
      contextMode: 'on-demand',
      messages: [message('server current message', 'server-u1')],
      model: 'gpt-4',
      onDemand: {
        retrieval: {
          candidates: [memoryCandidate],
          mode: 'vector',
        },
      },
      provider: 'openai',
      systemRole,
      userMemory: {
        memories: {
          contexts: [{ description: 'server memory body', id: 'memory-1' }],
          experiences: [],
          preferences: [],
        },
      },
    });

    expect(result.messages[0].content).toContain(systemRole);
    expect(result.messages[0].content).not.toContain('server memory body');
    expect(result.messages[1].content).toBe('server current message');
    expect(result.messages[2].content).toContain('server current message deployment preference');
    expect(result.onDemandContext).toMatchObject({
      contextMode: 'on-demand',
      dynamicEntries: expect.arrayContaining([
        expect.objectContaining({
          included: true,
          kind: 'memory',
        }),
      ]),
      retrieval: expect.objectContaining({
        includedCount: 1,
        mode: 'vector',
      }),
      stablePrefixHash: expect.stringMatching(/^md5:/),
    });
  });

  it('forwards selected skill/tool bodies and document cards into the dynamic suffix only', async () => {
    const systemRole = 'Server prompt';
    const result = await serverMessagesEngine({
      contextMode: 'on-demand',
      documentCards: [
        {
          description: 'Release notes for the current deployment',
          documentId: 'doc-backing-1',
          filename: 'release.md',
          id: 'doc-1',
          title: 'Release notes',
          updatedAt: '2026-01-02T03:04:05.000Z',
        },
      ],
      initialContext: {
        selectedSkills: [
          {
            content: 'Selected deployment body',
            identifier: 'deploy',
            name: 'Deploy',
          },
        ],
        selectedTools: [
          {
            content: 'Selected release-tool contract',
            identifier: 'release-tool',
            name: 'Release Tool',
          },
        ],
      },
      messages: [message('deploy the release', 'server-u1')],
      model: 'gpt-4',
      provider: 'openai',
      systemRole,
    });

    const suffix = result.messages
      .slice(2)
      .map((entry) => entry.content)
      .join('\n');
    expect(result.messages[0].content).toContain(systemRole);
    expect(result.messages[0].content).not.toContain('Selected deployment body');
    expect(result.messages[0].content).not.toContain('Selected release-tool contract');
    expect(result.messages[0].content).not.toContain('Release notes for the current deployment');
    expect(suffix).toContain('Selected deployment body');
    expect(suffix).toContain('Selected release-tool contract');
    expect(suffix).toContain('<document_card');
    expect(suffix).toContain('release.md');
    expect(result.onDemandContext?.dynamicEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          included: true,
          key: 'skill:deploy:content',
          required: true,
        }),
        expect.objectContaining({
          included: true,
          key: 'document:doc-1:card',
          kind: 'document_card',
        }),
        expect.objectContaining({
          included: true,
          key: 'tool:release-tool:manual',
          required: true,
        }),
      ]),
    );
  });
});
