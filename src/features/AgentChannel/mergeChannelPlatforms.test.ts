import { describe, expect, it } from 'vitest';

import type { ChannelPlatformDefinition } from './const';
import { mergeChannelPlatforms } from './useAgentChannels';

const def = (id: string, extra: Partial<ChannelPlatformDefinition> = {}) =>
  ({
    connectionMode: 'websocket',
    id,
    name: id,
    schema: [],
    ...extra,
  }) as ChannelPlatformDefinition;

describe('mergeChannelPlatforms', () => {
  const unavailable = def('wecom', { unavailableReason: 'cannot run here' });

  it('hides a platform this deployment cannot run from an agent without a bot on it', () => {
    expect(mergeChannelPlatforms([def('qq'), unavailable], [], []).map((p) => p.id)).toEqual([
      'qq',
    ]);
  });

  it('keeps it for an agent that already has one, so the bot stays manageable', () => {
    expect(
      mergeChannelPlatforms([def('qq'), unavailable], [], [{ platform: 'wecom' }]).map((p) => p.id),
    ).toEqual(['qq', 'wecom']);
  });

  it('lets a coming-soon placeholder shadow a server platform of the same id', () => {
    const placeholder = def('imessage', { comingSoon: true });
    const merged = mergeChannelPlatforms([def('imessage'), def('qq')], [placeholder], []);
    expect(merged.map((p) => [p.id, !!p.comingSoon])).toEqual([
      ['qq', false],
      ['imessage', true],
    ]);
  });
});
