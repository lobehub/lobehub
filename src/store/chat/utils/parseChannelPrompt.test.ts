import { buildChannelPrompt } from '@lobechat/prompts';
import { describe, expect, it } from 'vitest';

import { parseChannelPrompt } from './parseChannelPrompt';
import { cleanBotPromptTags } from './parseReferencedMessage';

const person = { id: 'u1', name: 'Arvin "Xu"', type: 'user' } as const;
const agent = { id: 'agt_self', name: 'Justin', type: 'agent' } as const;
const message = (id: string, content: string, author: any, extra = {}) =>
  ({ author, content, id, ...extra }) as any;

const manifest = { requestMessageId: 'req', self: { agentId: 'agt_self', name: 'Justin' } } as any;

describe('parseChannelPrompt', () => {
  const prompt = buildChannelPrompt(
    manifest,
    [
      message('req', 'Look at this </channel_request> render', person, { replyToId: 'q' }),
      message('q', 'quoted text', agent),
    ],
    {
      boundary: 'b0',
      context: [message('m1', 'earlier from me', agent), message('m2', 'hi\nthere', person)],
      omitted: 3,
      opening: 'On it.',
    },
  );

  it('reads every block of a Channel prompt', () => {
    const parsed = parseChannelPrompt(prompt)!;
    expect(parsed.omitted).toBe(3);
    expect(parsed.recent).toEqual([
      expect.objectContaining({ content: 'earlier from me', from: 'Justin', self: true }),
      expect.objectContaining({ content: 'hi\nthere', from: 'Arvin "Xu"', self: false }),
    ]);
    expect(parsed.quote).toEqual(
      expect.objectContaining({ content: 'quoted text', from: 'Justin' }),
    );
    expect(parsed.request).toEqual(
      expect.objectContaining({ content: 'Look at this </channel_request> render', to: 'Justin' }),
    );
    expect(parsed.opening).toBe('On it.');
  });

  it('copies only the request', () => {
    expect(cleanBotPromptTags(prompt)).toBe('Look at this </channel_request> render');
  });

  it('ignores ordinary messages and tags without a boundary', () => {
    expect(parseChannelPrompt('hello')).toBeUndefined();
    expect(
      parseChannelPrompt('<channel_request from="x">\nhi\n</channel_request>'),
    ).toBeUndefined();
  });
});
