import { RequestTrigger } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import enUSSpend from '../../../../locales/en-US/spend.json';
import zhCNSpend from '../../../../locales/zh-CN/spend.json';
import spend from './spend';

const missingTriggerLabels = (resources: Record<string, string>) =>
  Object.values(RequestTrigger).filter(
    (trigger) => !resources[`table.columns.trigger.enums.${trigger}`],
  );

describe('spend trigger labels', () => {
  it('labels every request trigger in the default resources', () => {
    expect(missingTriggerLabels(spend)).toEqual([]);
  });

  it('labels every request trigger in en-US and zh-CN', () => {
    expect(missingTriggerLabels(enUSSpend)).toEqual([]);
    expect(missingTriggerLabels(zhCNSpend)).toEqual([]);
  });
});
