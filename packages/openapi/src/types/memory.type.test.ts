import { describe, expect, it } from 'vitest';

import {
  MemoryCategoryEntriesSchema,
  MemoryPersonaSchema,
  MemoryPersonaVersionSchema,
} from './memory.type';

// A JSON round trip on purpose: `structuredClone` would keep the Dates the wire turns into strings.
// eslint-disable-next-line unicorn/prefer-structured-clone
const wire = <T>(value: T) => JSON.parse(JSON.stringify(value));
const now = new Date('2026-11-17T08:00:00.000Z');

const base = {
  accessedAt: now,
  capturedAt: now,
  createdAt: now,
  id: 'mem-1',
  metadata: null,
  tags: ['work'],
  type: 'personal',
  updatedAt: now,
  userId: 'user-1',
};

describe('memory response schemas', () => {
  it('accepts the persona and its versions', () => {
    expect(() => MemoryPersonaSchema.nullable().parse(null)).not.toThrow();
    expect(() => MemoryPersonaSchema.parse({ content: 'Builder', summary: 'Ships' })).not.toThrow();
    expect(() =>
      MemoryPersonaVersionSchema.parse(
        wire({
          createdAt: now,
          id: 'hist-1',
          nextVersion: 2,
          previousVersion: 1,
          snapshotPersona: 'Builder',
          snapshotTagline: null,
        }),
      ),
    ).not.toThrow();
  });

  it('accepts identity rows without their vectors', () => {
    const identity = {
      ...base,
      description: 'Engineer',
      entityId: null,
      episodicDate: null,
      relationship: 'self',
      role: 'engineer',
      userMemoryId: 'um-1',
    };

    expect(() => MemoryCategoryEntriesSchema.parse(wire([identity]))).not.toThrow();
    expect(
      MemoryCategoryEntriesSchema.safeParse(wire([{ ...identity, descriptionVector: [0.1] }]))
        .success,
    ).toBe(false);
  });

  it('accepts activity rows', () => {
    const activity = {
      ...base,
      associatedLocations: [{ name: 'Osaka' }],
      associatedObjects: null,
      associatedSubjects: null,
      dossierId: null,
      endsAt: null,
      feedback: null,
      injectable: true,
      narrative: 'Visited Osaka',
      notes: null,
      startsAt: now,
      status: 'completed',
      timezone: 'Asia/Tokyo',
      type: 'travel',
      userMemoryId: 'um-2',
    };

    expect(() => MemoryCategoryEntriesSchema.parse(wire([activity]))).not.toThrow();
  });
});
