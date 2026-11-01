import type { UIChatMessage } from '@lobechat/types';
import { expect, it } from 'vitest';

import { resolveMessageFileUrls } from '../resolveMessageFileUrls';

it('bounds URL resolution across messages and nested groups without changing the input', async () => {
  const attachment = (id: string) => ({ alt: id, id, url: `raw/${id}` });
  const messages = Array.from({ length: 20 }, (_, index) => ({
    id: `message-${index}`,
    role: 'user',
    imageList: [attachment(`image-${index}`)],
    members: [
      {
        id: `member-${index}`,
        role: 'user',
        audioList: [attachment(`audio-${index}`)],
      },
    ],
  })) as UIChatMessage[];
  const original = structuredClone(messages);
  let active = 0;
  let peak = 0;
  const resolved = await resolveMessageFileUrls(messages, async (file) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 0));
    active -= 1;
    return `resolved/${file.id}`;
  });

  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(10);
  expect(messages).toEqual(original);
  expect(resolved.map((message) => message.id)).toEqual(messages.map((message) => message.id));
  for (const [index, message] of resolved.entries()) {
    expect(message.imageList![0].url).toBe(`resolved/image-${index}`);
    expect(message.members![0].audioList![0].url).toBe(`resolved/audio-${index}`);
  }
});
