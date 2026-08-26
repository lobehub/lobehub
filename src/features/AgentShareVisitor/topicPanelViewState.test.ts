import { describe, expect, it } from 'vitest';

import { getTopicPanelViewState } from './topicPanelViewState';

describe('getTopicPanelViewState', () => {
  it('is "loading" while the fetch is pending, even though topics is undefined', () => {
    expect(getTopicPanelViewState(undefined, undefined, true)).toBe('loading');
  });

  it('is "error" when the fetch rejected, even though topics is undefined', () => {
    expect(getTopicPanelViewState(undefined, new Error('network down'), false)).toBe('error');
  });

  it('prefers "error" over "loading" if both are somehow set', () => {
    expect(getTopicPanelViewState(undefined, new Error('boom'), true)).toBe('error');
  });

  it('is "empty" only once loading has finished with no error and no topics', () => {
    expect(getTopicPanelViewState([], undefined, false)).toBe('empty');
    expect(getTopicPanelViewState(undefined, undefined, false)).toBe('empty');
  });

  it('is "list" once loading has finished with topics present', () => {
    expect(getTopicPanelViewState([{ id: 't1' }], undefined, false)).toBe('list');
  });
});
