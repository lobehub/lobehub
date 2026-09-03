import { describe, expect, it } from 'vitest';

import { getTopicPanelViewState } from './topicPanelViewState';

describe('getTopicPanelViewState', () => {
  it('reports error first, even while a revalidation is in flight', () => {
    expect(getTopicPanelViewState(undefined, new Error('boom'), true)).toBe('error');
    expect(getTopicPanelViewState([{}], new Error('boom'), false)).toBe('error');
  });

  it('reports loading before falling back to empty', () => {
    expect(getTopicPanelViewState(undefined, undefined, true)).toBe('loading');
  });

  it('only reports empty for a settled, genuinely empty list', () => {
    expect(getTopicPanelViewState([], undefined, false)).toBe('empty');
    expect(getTopicPanelViewState(undefined, undefined, false)).toBe('empty');
  });

  it('reports list when topics exist', () => {
    expect(getTopicPanelViewState([{}], undefined, false)).toBe('list');
  });
});
