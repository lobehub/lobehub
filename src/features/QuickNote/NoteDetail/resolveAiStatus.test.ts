import { describe, expect, it } from 'vitest';

import type { QuickNoteItem } from '@/services/quickNote';

import { resolveAiStatus } from './resolveAiStatus';

const createNote = (patch: Partial<QuickNoteItem>): QuickNoteItem => ({
  content: '',
  createdAt: 1000,
  id: 'note-1',
  tags: [],
  updatedAt: 1000,
  ...patch,
});

describe('resolveAiStatus', () => {
  it('returns pending when the run is pending', () => {
    const note = createNote({ run: { kind: 'analyze', status: 'pending' } });
    expect(resolveAiStatus(note, 2000)).toEqual({ key: 'pending' });
  });

  it('returns running when the run is running', () => {
    const note = createNote({ run: { kind: 'analyze', status: 'running' } });
    expect(resolveAiStatus(note, 2000)).toEqual({ key: 'running' });
  });

  it('returns failed when the run failed', () => {
    const note = createNote({ run: { kind: 'analyze', status: 'failed' } });
    expect(resolveAiStatus(note, 2000)).toEqual({ key: 'failed' });
  });

  it('running takes precedence over a scheduled countdown', () => {
    const note = createNote({
      analyzeDueAt: 5000,
      run: { kind: 'analyze', status: 'running' },
    });
    expect(resolveAiStatus(note, 2000)).toEqual({ key: 'running' });
  });

  it('returns scheduled with rounded-up remaining seconds', () => {
    const note = createNote({ analyzeDueAt: 4500 });
    expect(resolveAiStatus(note, 2000)).toEqual({ key: 'scheduled', seconds: 3 });
  });

  it('rounds a sub-second remainder up to at least one second', () => {
    const note = createNote({ analyzeDueAt: 2100 });
    expect(resolveAiStatus(note, 2000)).toEqual({ key: 'scheduled', seconds: 1 });
  });

  it('returns analyzed using the annotation dive time', () => {
    const note = createNote({
      annotation: { content: 'summary', divedAt: 1500 },
      updatedAt: 1800,
    });
    expect(resolveAiStatus(note, 2000)).toEqual({ at: 1500, key: 'analyzed' });
  });

  it('returns analyzed using updatedAt when the run completed without a dive time', () => {
    const note = createNote({
      run: { kind: 'analyze', status: 'completed' },
      updatedAt: 1800,
    });
    expect(resolveAiStatus(note, 2000)).toEqual({ at: 1800, key: 'analyzed' });
  });

  it('returns idle when nothing has happened yet', () => {
    const note = createNote({});
    expect(resolveAiStatus(note, 2000)).toEqual({ key: 'idle' });
  });
});
