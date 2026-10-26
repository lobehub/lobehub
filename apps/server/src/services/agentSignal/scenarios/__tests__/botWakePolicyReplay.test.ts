// @vitest-environment node
import { aggregateWakeVerdictsAsync } from '../botWake/aggregator';
import { createWakePolicySet } from '../botWake/policies';
import type { WakeChannelState, WakeSignal } from '../botWake/types';
import replay from './__fixtures__/botWakePolicyReplay.json';

interface Entry {
  channel: Partial<WakeChannelState>;
  classifier?: { addressedToBot: number; kind: 'chitchat' | 'other' | 'request'; reason: string };
  expected: {
    classifier: [string, number] | null;
    internal: [string, string];
    owner: [string, string];
  };
  name: string;
  signal: {
    at: number;
    author: { id: string; isBot?: boolean; isOwner?: boolean };
    ids: string[];
    mentions?: Partial<NonNullable<WakeSignal['mentions']>>;
    message: string;
  };
}

/**
 * Replays recorded (message, channel-state snapshot) pairs through the full policy set and
 * compares each policy's verdict with what was recorded. The classifier is replaced by the
 * score the model returned at record time, so the replay is deterministic and free.
 */
describe('bot-wake policy replay from recorded state snapshots', () => {
  it.each((replay.entries as Entry[]).map((entry) => [entry.name, entry] as const))(
    '%s',
    async (_name, entry) => {
      const classify = vi.fn(async () => entry.classifier!);
      const policies = createWakePolicySet({ classify, settings: replay.settings });
      const signal: WakeSignal = {
        author: {
          isBot: false,
          isMe: false,
          isOwner: false,
          isSystem: false,
          ...entry.signal.author,
        },
        channelKeys: { channelKey: 'k', ids: entry.signal.ids },
        mentions: {
          botMentioned: false,
          everyone: false,
          here: false,
          otherUserIds: [],
          roleIds: [],
          ...entry.signal.mentions,
        },
        message: entry.signal.message,
        timestamp: entry.signal.at,
      };

      const decision = await aggregateWakeVerdictsAsync(policies, signal, {
        channel: { silentWakes: 0, ...entry.channel },
        explicitMention: false,
        replyToBot: false,
        threadSubscribed: true,
      });
      const byId = Object.fromEntries(decision.records.map((record) => [record.policyId, record]));

      expect([
        byId['bot-wake:internal-rules'].verdict,
        byId['bot-wake:internal-rules'].reason,
      ]).toEqual(entry.expected.internal);
      expect([byId['bot-wake:owner-rules'].verdict, byId['bot-wake:owner-rules'].reason]).toEqual(
        entry.expected.owner,
      );

      if (entry.expected.classifier) {
        expect([
          byId['bot-wake:classifier'].verdict,
          byId['bot-wake:classifier'].confidence,
        ]).toEqual(entry.expected.classifier);
      } else {
        // A message a cheap rule already denied never reaches the model.
        expect(byId['bot-wake:classifier']).toBeUndefined();
        expect(classify).not.toHaveBeenCalled();
      }

      // Shadow by default: whatever the policies said, the aggregate does not enforce.
      expect(decision.verdict).toBe('abstain');
      expect(decision.records.every((record) => !record.effective)).toBe(true);
    },
  );
});
