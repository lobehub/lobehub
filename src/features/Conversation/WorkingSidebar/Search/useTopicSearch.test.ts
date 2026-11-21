import type { TopicMessageSearchMatch } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { selectTopicSearchView } from './useTopicSearch';

const match = (id: string) => ({ id }) as TopicMessageSearchMatch;
const deploy = { keyword: 'deploy', matches: [match('m1'), match('m2')] };

describe('selectTopicSearchView', () => {
  it('lists the matches that answer the current keyword', () => {
    expect(selectTopicSearchView({ data: deploy, query: 'deploy' })).toEqual({
      failed: false,
      isSearching: false,
      matches: deploy.matches,
    });
  });

  it('keeps the previous matches only while the new keyword is loading', () => {
    expect(selectTopicSearchView({ data: deploy, query: 'release' })).toEqual({
      failed: false,
      isSearching: true,
      matches: deploy.matches,
    });
  });

  it('drops the previous matches and reports the failure when the new keyword errors', () => {
    expect(
      selectTopicSearchView({ data: deploy, error: new Error('offline'), query: 'release' }),
    ).toEqual({ failed: true, isSearching: false, matches: [] });
  });

  it('keeps a successful result when only its revalidation failed', () => {
    expect(
      selectTopicSearchView({ data: deploy, error: new Error('offline'), query: 'deploy' }).matches,
    ).toEqual(deploy.matches);
  });

  it('shows nothing without a keyword', () => {
    expect(selectTopicSearchView({ data: deploy, query: '' })).toEqual({
      failed: false,
      isSearching: false,
      matches: [],
    });
  });
});
