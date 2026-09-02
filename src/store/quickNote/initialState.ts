import type { QuickNoteItem } from '@/services/quickNote';

export type QuickNoteSaveStatus = 'failed' | 'idle' | 'saved' | 'saving';

export const UNCATEGORIZED_KEY = 'uncategorized';

export interface QuickNoteState {
  activeCollection: string | null;
  activeNoteId?: string;
  activeTag: string | null;
  annotationPanelExpanded: boolean;
  divingNoteIds: string[];
  listCollapsed: boolean;
  notes: QuickNoteItem[];
  notesInit: boolean;
  saveStatus: QuickNoteSaveStatus;
  searchKeywords: string;
}

export const initialState: QuickNoteState = {
  activeCollection: null,
  activeTag: null,
  annotationPanelExpanded: true,
  divingNoteIds: [],
  listCollapsed: false,
  notes: [],
  notesInit: false,
  saveStatus: 'idle',
  searchKeywords: '',
};
