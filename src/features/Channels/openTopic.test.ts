import { describe, expect, it } from 'vitest';

import { openTopic } from './openTopic';

const topic = { channelId: 'ch-1' } as Parameters<typeof openTopic>[0];
const none = { acceptance: false, members: false, thread: false };

describe('openTopic', () => {
  it('shows the topic of the current Channel when nothing covers it', () => {
    expect(openTopic(topic, 'ch-1', none)).toBe(topic);
    expect(openTopic(topic, 'ch-2', none)).toBeNull();
  });

  it('hides the topic once a thread opens, including a thread opened as the page', () => {
    expect(openTopic(topic, 'ch-1', { ...none, thread: true })).toBeNull();
    expect(openTopic(topic, 'ch-1', { ...none, members: true })).toBeNull();
    expect(openTopic(topic, 'ch-1', { ...none, acceptance: true })).toBeNull();
  });
});
