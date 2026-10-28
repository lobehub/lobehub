// Fixture: a command filtered out for one platform only.
import { beforeEach, expect, it, vi } from 'vitest';

import { createRouter } from './router';

const sendDmText = vi.fn();
const handleMention = vi.fn();

beforeEach(() => vi.clearAllMocks());

it('omits /start from WeChat help', async () => {
  const router = createRouter({ handleMention, platform: 'wechat', sendDmText });
  await router.onMention({ isMention: true, text: '/help' });

  expect(sendDmText.mock.calls[0][1]).toContain('可用命令：');
  expect(sendDmText.mock.calls[0][1]).not.toContain('/start');
});

it('does not intercept /start as a WeChat system command', async () => {
  const router = createRouter({ handleMention, platform: 'wechat', sendDmText });
  await router.onMention({ isMention: true, text: '/start' });

  expect(sendDmText).not.toHaveBeenCalled();
  expect(handleMention).toHaveBeenCalledTimes(1);
});
