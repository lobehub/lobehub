import type { JSONSchema7 } from 'json-schema';
import { describe, expect, it } from 'vitest';

import { ActivityMemoryItemSchema, ActivityMemorySchema } from './activity';

describe('ActivityMemoryItemSchema', () => {
  it('accepts nullable activity metadata from generated schema output', () => {
    const result = ActivityMemoryItemSchema.safeParse({
      details: 'The user completed a planned activity.',
      memoryCategory: 'work',
      memoryType: 'activity',
      summary: 'The user completed an activity.',
      tags: ['activity'],
      title: 'Completed an activity',
      withActivity: {
        associatedLocations: null,
        associatedObjects: null,
        associatedSubjects: null,
        endsAt: null,
        feedback: null,
        metadata: null,
        narrative: 'The activity was completed.',
        notes: null,
        startsAt: null,
        status: 'completed',
        tags: ['activity'],
        timezone: null,
        type: 'work',
      },
    });

    expect(result.success).toBe(true);
  });

  /**
   * @example
   * A context item must not pass validation as an activity item.
   */
  it('rejects a non-activity memory type', () => {
    const result = ActivityMemoryItemSchema.safeParse({
      details: 'The user completed a planned activity.',
      memoryCategory: 'work',
      memoryType: 'context',
      summary: 'The user completed an activity.',
      tags: ['activity'],
      title: 'Completed an activity',
      withActivity: {
        narrative: 'The activity was completed.',
      },
    });

    /**
     * @example
     * `memoryType: "context"` produces an unsuccessful parse.
     */
    expect(result.success).toBe(false);
  });

  /**
   * @example
   * An activity without an explicit lifecycle status emits `status: null`.
   */
  it('allows null in the generated activity status enum', () => {
    const rootSchema = ActivityMemorySchema.schema as JSONSchema7;
    const memoriesSchema = rootSchema.properties?.memories as JSONSchema7;
    const memoryItemSchema = memoriesSchema.items as JSONSchema7;
    const withActivitySchema = memoryItemSchema.properties?.withActivity as JSONSchema7;
    const statusSchema = withActivitySchema.properties?.status as JSONSchema7;

    /**
     * @example
     * The strict schema status enum contains both `"completed"` and `null`.
     */
    expect(statusSchema.enum).toEqual([
      'planned',
      'completed',
      'cancelled',
      'ongoing',
      'on_hold',
      'pending',
      null,
    ]);
  });
});
