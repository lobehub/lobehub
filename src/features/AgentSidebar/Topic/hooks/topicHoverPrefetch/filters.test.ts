import { describe, expect, it } from 'vitest';

import { canPrefetchTopicFirstPage, canPreviewTopic, type TopicHoverEnv } from './filters';

const env = (overrides: Partial<TopicHoverEnv> = {}): TopicHoverEnv => ({
  activeTopicId: 'tpc_open',
  creatingTopicIds: [],
  enabled: true,
  hasLocalMessages: () => false,
  hasPreview: () => false,
  hasReadingPosition: () => false,
  isProjectedRead: () => true,
  isRunning: () => false,
  ...overrides,
});

const row = { agentId: 'agt_1', topicId: 'tpc_a' };

describe('canPreviewTopic', () => {
  it('accepts a finished, unopened topic of a gateway agent', () => {
    expect(canPreviewTopic(row, env())).toBe(true);
  });

  it.each<
    [string, Partial<TopicHoverEnv>, Partial<typeof row & { groupId: string; status: string }>]
  >([
    ['the flag is off', { enabled: false }, {}],
    ['the agent runs in the browser', { isProjectedRead: () => false }, {}],
    ['the topic is open', { activeTopicId: 'tpc_a' }, {}],
    ['the topic is still being created', { creatingTopicIds: ['tpc_a'] }, {}],
    ['messages are already loaded', { hasLocalMessages: () => true }, {}],
    ['a valid preview is cached', { hasPreview: () => true }, {}],
    ['the reader left a reading position', { hasReadingPosition: () => true }, {}],
    ['a local run is going', { isRunning: () => true }, {}],
    ['the topic reports running', {}, { status: 'running' }],
    ['the topic waits for a human', {}, { status: 'waitingForHuman' }],
    ['the topic is a group chat', {}, { groupId: 'grp_1' }],
  ])('rejects when %s', (_, envOverrides, rowOverrides) => {
    expect(canPreviewTopic({ ...row, ...rowOverrides }, env(envOverrides))).toBe(false);
  });
});

describe('canPrefetchTopicFirstPage', () => {
  it('accepts an unopened topic of a gateway agent', () => {
    expect(canPrefetchTopicFirstPage(row, env())).toBe(true);
  });

  it('leaves loaded, open, browser-run and flag-off topics alone', () => {
    expect(canPrefetchTopicFirstPage(row, env({ hasLocalMessages: () => true }))).toBe(false);
    expect(canPrefetchTopicFirstPage(row, env({ activeTopicId: 'tpc_a' }))).toBe(false);
    expect(canPrefetchTopicFirstPage(row, env({ isProjectedRead: () => false }))).toBe(false);
    expect(canPrefetchTopicFirstPage(row, env({ enabled: false }))).toBe(false);
  });
});
