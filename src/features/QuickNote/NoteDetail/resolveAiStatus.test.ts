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

  it('returns analyzed using the summary completion time', () => {
    const note = createNote({
      summary: { completedAt: 1500, content: 'summary' },
      updatedAt: 1800,
    });
    expect(resolveAiStatus(note, 2000)).toEqual({ at: 1500, key: 'analyzed' });
  });

  it('returns analyzed using updatedAt when the run completed without a summary', () => {
    const note = createNote({
      run: { kind: 'analyze', status: 'completed' },
      updatedAt: 1800,
    });
    expect(resolveAiStatus(note, 2000)).toEqual({ at: 1800, key: 'analyzed' });
  });

  // ROOT CAUSE:
  // The time came from the note's `updated_at` (or an older summary), which moves with every
  // edit, so 「已分析 HH:MM」 showed the last save rather than when the analysis finished.
  it('returns analyzed using the latest Run completion time', () => {
    const note = createNote({
      run: { completedAt: 1600, kind: 'analyze', status: 'completed' },
      summary: { completedAt: 1200, content: 'older summary' },
      updatedAt: 1900,
    });
    expect(resolveAiStatus(note, 2000)).toEqual({ at: 1600, key: 'analyzed' });
  });

  it('returns idle when nothing has happened yet', () => {
    const note = createNote({});
    expect(resolveAiStatus(note, 2000)).toEqual({ key: 'idle' });
  });
});
