import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ContextMemorySchema } from '../../schemas/context';
import { IdentityActionsSchema } from '../../schemas/identity';
import { parseLenient } from '../lenientParse';

const identity = (withIdentity: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  details: null,
  memoryCategory: 'work',
  memoryType: 'people',
  summary: 'Works on payments',
  tags: ['work'],
  title: 'Payments engineer',
  withIdentity: {
    description: 'Builds the payments service',
    episodicDate: null,
    extractedLabels: ['payments'],
    relationship: 'self',
    role: 'engineer',
    scoreConfidence: 0.9,
    sourceEvidence: null,
    sourceIds: ['msg_1'],
    type: 'professional',
    ...withIdentity,
  },
  ...extra,
});

describe('parseLenient', () => {
  it('returns valid output untouched, with no repairs', () => {
    const schema = z.object({ items: z.array(z.object({ a: z.string() })) });

    expect(parseLenient(schema, { items: [{ a: 'x' }] })).toEqual({
      data: { items: [{ a: 'x' }] },
      repairs: [],
    });
  });

  it('files an off-list memoryType under "other" instead of failing the topic', () => {
    const { data, repairs } = parseLenient(IdentityActionsSchema, {
      add: [identity({}, { memoryType: 'career' })],
      remove: [],
      update: [],
    });

    expect(data.add![0].memoryType).toBe('other');
    expect(repairs).toEqual(['add.0.memoryType: other']);
  });

  it('moves fields the model lifted out of a nested object back into it', () => {
    const item = identity({});
    const { extractedLabels, scoreConfidence, sourceEvidence, sourceIds, ...withIdentity } =
      item.withIdentity;

    const { data } = parseLenient(IdentityActionsSchema, {
      add: [{ ...item, extractedLabels, scoreConfidence, sourceEvidence, sourceIds, withIdentity }],
      remove: [],
      update: [],
    });

    expect(data.add![0].withIdentity).toMatchObject({
      extractedLabels: ['payments'],
      scoreConfidence: 0.9,
      sourceIds: ['msg_1'],
    });
    expect(data.add![0]).not.toHaveProperty('scoreConfidence');
  });

  it('moves a lifted field back even when the nested object reports it missing', () => {
    const { type, ...withIdentity } = identity({}).withIdentity;

    const { data } = parseLenient(IdentityActionsSchema, {
      add: [{ ...identity({}), type, withIdentity }],
      remove: [],
      update: [],
    });

    expect(data.add![0].withIdentity.type).toBe('professional');
  });

  it('drops keys that belong nowhere', () => {
    const { data, repairs } = parseLenient(IdentityActionsSchema, {
      add: [identity({ mood: 'happy' }, { confidence: 'high' })],
      remove: [],
      update: [],
    });

    expect(data.add![0]).not.toHaveProperty('confidence');
    expect(data.add![0].withIdentity).not.toHaveProperty('mood');
    expect(repairs).toEqual(expect.arrayContaining(['add.0: dropped key confidence']));
  });

  it('drops only the entry it cannot repair and keeps the others', () => {
    const { data, repairs } = parseLenient(IdentityActionsSchema, {
      add: [identity({ type: 'astrological' }), identity({}, { title: 'Kept' })],
      remove: [],
      update: [],
    });

    expect(data.add).toHaveLength(1);
    expect(data.add![0].title).toBe('Kept');
    expect(repairs).toContain('add.0: dropped entry');
  });

  it('reads strings as the numbers and booleans they spell, and null as absent', () => {
    const schema = z.object({
      count: z.number(),
      enabled: z.boolean(),
      note: z.string().optional(),
    });

    expect(parseLenient(schema, { count: '3', enabled: 'false', note: null }).data).toEqual({
      count: 3,
      enabled: false,
    });
  });

  it('repairs context memories the way production output went wrong', () => {
    const context = {
      details: 'details',
      memoryCategory: 'work',
      memoryType: 'project',
      summary: 'Migrating search',
      tags: [],
      title: 'Search migration',
      withContext: {
        associatedObjects: [],
        associatedSubjects: [],
        currentStatus: 'ongoing',
        description: 'Moving search to Elasticsearch',
        labels: [],
        scoreImpact: 0.5,
        scoreUrgency: 0.5,
        title: 'Search migration',
        type: 'project',
      },
    };
    const parsed = ContextMemorySchema.safeParse({ memories: [context] });
    // The fixture only fails on the field under test.
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'))).toEqual([
      'memories.0.memoryType',
    ]);

    expect(
      parseLenient(ContextMemorySchema, { memories: [context] }).data.memories[0],
    ).toMatchObject({ memoryType: 'other', title: 'Search migration' });
  });

  it('still fails when the output as a whole is unusable', () => {
    const schema = z.object({ memories: z.array(z.object({ a: z.string() })) });

    expect(() => parseLenient(schema, { nothing: true })).toThrow();
    expect(() => parseLenient(schema, 'not an object')).toThrow();
  });

  it('keeps preprocessing schemas working', () => {
    const schema = z.object({
      decision: z.preprocess(
        (value) => (typeof value === 'boolean' ? { ok: value } : value),
        z.object({ ok: z.boolean() }).strict(),
      ),
    });

    expect(parseLenient(schema, { decision: true }).data).toEqual({ decision: { ok: true } });
    expect(parseLenient(schema, { decision: { extra: 1, ok: 'true' } }).data).toEqual({
      decision: { ok: true },
    });
  });
});
