import { describe, expect, it } from 'vitest';

import { filterAvailableLabFeatures, type LabFeatureItem } from './features';

const features: LabFeatureItem[] = [
  { flag: 'enableGoals', i18nKey: 'goals', searchKeywords: [], stage: 'beta' },
  {
    businessOnly: true,
    flag: 'enableTopicBugReport',
    i18nKey: 'topicBugReport',
    searchKeywords: [],
    stage: 'alpha',
  },
];

describe('filterAvailableLabFeatures', () => {
  it('hides business-only experiments when business features are off', () => {
    expect(filterAvailableLabFeatures(features, false).map(({ flag }) => flag)).toEqual([
      'enableGoals',
    ]);
  });

  it('offers business-only experiments when business features are on', () => {
    expect(filterAvailableLabFeatures(features, true).map(({ flag }) => flag)).toEqual([
      'enableGoals',
      'enableTopicBugReport',
    ]);
  });
});
