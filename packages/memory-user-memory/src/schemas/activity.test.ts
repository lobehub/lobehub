import { describe, expect, it } from 'vitest';

import { ActivityMemoryItemSchema } from './activity';

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
});
