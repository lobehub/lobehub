import { describe, expect, it } from 'vitest';

import {
  chainGoalCriteriaDraft,
  GOAL_CRITERIA_DRAFT_JSON_SCHEMA,
  GOAL_CRITERIA_DRAFT_PROMPT_VERSION,
} from './goal';

describe('chainGoalCriteriaDraft', () => {
  it('owns a dedicated version, schema, and standing-goal prompt', () => {
    const chain = chainGoalCriteriaDraft({
      context: 'Goal: Release the product',
      goal: 'Ship a polished v1',
      maxCriteria: 6,
    });

    expect(GOAL_CRITERIA_DRAFT_PROMPT_VERSION).toBe('v3');
    expect(GOAL_CRITERIA_DRAFT_JSON_SCHEMA.name).toBe('goal_criteria_draft');
    expect(chain.messages[0].content).toContain('persistent autonomous goal');
    expect(chain.messages[0].content).toContain('at most 6 criteria');
    expect(chain.messages[0].content).toContain(
      'top-level instruction is a complete, actionable task brief',
    );
    expect(chain.messages[0].content).toContain(
      'criteria[].instruction is the exact, detailed judging rubric',
    );
    expect(chain.messages[0].content).toContain('Preserve every explicit numeric threshold');
    expect(chain.messages[0].content).toContain('do not invent an arbitrary one');
    expect(GOAL_CRITERIA_DRAFT_JSON_SCHEMA.schema.required).toEqual([
      'title',
      'instruction',
      'criteria',
    ]);
    expect(chain.messages[1].content).toContain('Ship a polished v1');
  });
});
