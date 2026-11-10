import type {
  GoalRolloutTrigger as GoalRolloutTriggerType,
  GoalStatus as GoalStatusType,
  GoalSubjectType as GoalSubjectTypeType,
} from '@lobechat/types';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { goalRolloutTriggers, goalStatuses, goalSubjectTypes } from './goal';

describe('goal consts', () => {
  it('stays in sync with the @lobechat/types unions', () => {
    expectTypeOf<(typeof goalStatuses)[number]>().toEqualTypeOf<GoalStatusType>();
    expectTypeOf<(typeof goalSubjectTypes)[number]>().toEqualTypeOf<GoalSubjectTypeType>();
    expectTypeOf<(typeof goalRolloutTriggers)[number]>().toEqualTypeOf<GoalRolloutTriggerType>();
  });

  it('keeps terminal states last-ish sanity', () => {
    expect(goalStatuses).toContain('achieved');
    expect(goalSubjectTypes).toContain('task');
    expect(goalRolloutTriggers).toContain('canary');
  });
});
