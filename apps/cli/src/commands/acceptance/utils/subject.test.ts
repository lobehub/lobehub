import { afterEach, describe, expect, it } from 'vitest';

import { parseSubjectRef, subjectFromEnv, subjectFromResult } from '.';

describe('parseSubjectRef / subjectFromResult — acceptance subject', () => {
  it('parses the closed set of type:id references', () => {
    expect(parseSubjectRef('task:task_123')).toEqual({
      subjectId: 'task_123',
      subjectType: 'task',
    });
    expect(parseSubjectRef('topic:tpc_abc')).toEqual({
      subjectId: 'tpc_abc',
      subjectType: 'topic',
    });
    expect(parseSubjectRef('document:doc_1')).toEqual({
      subjectId: 'doc_1',
      subjectType: 'document',
    });
  });

  it('rejects unknown types and malformed references', () => {
    expect(parseSubjectRef('release:rel_1')).toBeNull();
    expect(parseSubjectRef('task:')).toBeNull();
    expect(parseSubjectRef('task_123')).toBeNull();
    expect(parseSubjectRef(undefined)).toBeNull();
  });

  it('keeps an id containing colons intact (splits on the FIRST colon only)', () => {
    expect(parseSubjectRef('topic:tpc:odd:id')).toEqual({
      subjectId: 'tpc:odd:id',
      subjectType: 'topic',
    });
  });

  it('reads result.json subject in both string and object shapes', () => {
    expect(subjectFromResult({ subject: 'task:task_9' })).toEqual({
      ref: { subjectId: 'task_9', subjectType: 'task' },
    });
    expect(
      subjectFromResult({
        subject: { id: 'tpc_1', requirement: 'no regressions', type: 'topic' },
      }),
    ).toEqual({
      ref: { subjectId: 'tpc_1', subjectType: 'topic' },
      requirement: 'no regressions',
    });
  });

  it('returns null on a malformed subject field instead of guessing', () => {
    expect(subjectFromResult({})).toBeNull();
    expect(subjectFromResult({ subject: 'nonsense' })).toBeNull();
    expect(subjectFromResult({ subject: { id: 'x' } })).toBeNull();
  });
});

describe('subjectFromEnv — default topic acceptance', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('binds an in-app run to its authoring topic', () => {
    process.env.LOBEHUB_TOPIC_ID = 'tpc_1';

    expect(subjectFromEnv()).toEqual({ subjectId: 'tpc_1', subjectType: 'topic' });
  });

  it('requires an explicit subject outside a topic', () => {
    delete process.env.LOBEHUB_TOPIC_ID;

    expect(subjectFromEnv()).toBeNull();
  });
});
