import { createSeedNotes } from './seed';
import type { QuickNoteItem } from './type';

export type { QuickNoteAnnotation, QuickNoteItem } from './type';

const STORAGE_KEY = 'LOBE_QUICK_NOTE_MOCK';

class QuickNoteService {
  getNotes = async (): Promise<QuickNoteItem[]> => {
    if (typeof window === 'undefined') return [];

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as QuickNoteItem[];
      } catch {
        /* corrupted payload falls back to reseeding */
      }
    }

    const seed = createSeedNotes();
    await this.saveNotes(seed);
    return seed;
  };

  saveNotes = async (notes: QuickNoteItem[]) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  };
}

export const quickNoteService = new QuickNoteService();
