import { describe, expect, it } from 'vitest';

import {
  buildAgentModelCandidates,
  detectRequiredCapabilities,
  selectAgentModelCandidates,
} from './failover';

describe('chat failover helpers', () => {
  it('deduplicates the primary model from the failover chain', () => {
    expect(
      buildAgentModelCandidates({
        failoverModels: [
          { model: 'gpt-4o-mini', provider: 'openai' },
          { model: 'gpt-4o', provider: 'openai' },
          { model: 'gpt-4o', provider: 'openai' },
        ],
        primary: { model: 'gpt-4o-mini', provider: 'openai' },
      }),
    ).toEqual([
      { index: 0, model: 'gpt-4o-mini', provider: 'openai', source: 'primary' },
      { index: 1, model: 'gpt-4o', provider: 'openai', source: 'failover' },
    ]);
  });

  it('detects required capabilities from message attachments and tools', () => {
    expect(
      detectRequiredCapabilities({
        messages: [
          {
            content: 'look at this image and video',
            createdAt: Date.now(),
            id: 'msg-1',
            imageList: [{ alt: 'image', id: 'img-1', url: 'https://example.com/1.png' }] as any,
            role: 'user',
            updatedAt: Date.now(),
            videoList: [{ alt: 'video', id: 'vid-1', url: 'https://example.com/1.mp4' }] as any,
          },
        ],
        tools: [{ function: { description: '', name: 'tool' }, type: 'function' }],
      }),
    ).toEqual(['functionCall', 'vision', 'video']);
  });

  it('prefers a capability-matching fallback model when the primary lacks vision', () => {
    const result = selectAgentModelCandidates({
      failoverModels: [{ model: 'gpt-4o', provider: 'openai' }],
      messages: [
        {
          content: 'describe this image',
          createdAt: Date.now(),
          id: 'msg-1',
          imageList: [{ alt: 'image', id: 'img-1', url: 'https://example.com/1.png' }] as any,
          role: 'user',
          updatedAt: Date.now(),
        },
      ],
      primary: { model: 'text-only-model', provider: 'openai' },
      supportsCapability: (model, _provider, capability) =>
        capability === 'vision' ? model === 'gpt-4o' : true,
    });

    expect(result.requiredCapabilities).toEqual(['vision']);
    expect(result.candidates).toEqual([
      { index: 1, model: 'gpt-4o', provider: 'openai', source: 'failover' },
    ]);
  });

  it('falls back to the full chain when no configured model satisfies the capability need', () => {
    const result = selectAgentModelCandidates({
      failoverModels: [{ model: 'backup-model', provider: 'openai' }],
      messages: [
        {
          content: 'describe this image',
          createdAt: Date.now(),
          id: 'msg-1',
          imageList: [{ alt: 'image', id: 'img-1', url: 'https://example.com/1.png' }] as any,
          role: 'user',
          updatedAt: Date.now(),
        },
      ],
      primary: { model: 'text-only-model', provider: 'openai' },
      supportsCapability: () => false,
    });

    expect(result.candidates).toEqual([
      { index: 0, model: 'text-only-model', provider: 'openai', source: 'primary' },
      { index: 1, model: 'backup-model', provider: 'openai', source: 'failover' },
    ]);
  });
});
