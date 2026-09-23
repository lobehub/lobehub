import type { QuickNoteItem } from '@/services/quickNote';

export interface AiStatus {
  at?: number;
  key: 'analyzed' | 'failed' | 'idle' | 'pending' | 'running' | 'scheduled';
  seconds?: number;
}

export const resolveAiStatus = (note: QuickNoteItem, now: number): AiStatus => {
  if (note.run?.status === 'pending') return { key: 'pending' };
  if (note.run?.status === 'running') return { key: 'running' };
  if (note.run?.status === 'failed') return { key: 'failed' };

  if (note.analyzeDueAt && note.analyzeDueAt > now)
    return { key: 'scheduled', seconds: Math.max(1, Math.ceil((note.analyzeDueAt - now) / 1000)) };

  if (note.annotation?.divedAt || note.run?.status === 'completed')
    return { at: note.annotation?.divedAt ?? note.updatedAt, key: 'analyzed' };

  return { key: 'idle' };
};
