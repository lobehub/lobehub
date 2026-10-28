// Fixture: a handler the router deliberately never registers, with the reason in the test.
import { expect, it, vi } from 'vitest';

import { loadBot } from './testUtils';

const chatBot = vi.hoisted(() => ({
  onDirectMessage: vi.fn(),
  onNewMention: vi.fn(),
  onSubscribedMessage: vi.fn(),
}));

it('does not register an onDirectMessage handler', async () => {
  // The router intentionally skips `onDirectMessage` so the SDK's DM dispatch
  // falls through to mention/subscription routing. Registering it would
  // short-circuit `isSubscribed` and stop DM follow-ups from continuing the
  // cached topic.
  await loadBot(chatBot);
  expect(chatBot.onDirectMessage).not.toHaveBeenCalled();
  expect(chatBot.onNewMention).toHaveBeenCalledOnce();
});
