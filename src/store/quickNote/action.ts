import { nanoid } from '@lobechat/utils';
import { debounce } from 'es-toolkit/compat';

import { type QuickNoteItem, quickNoteService } from '@/services/quickNote';
import { mockGenerateAnnotation, mockGenerateTags } from '@/services/quickNote/mockAI';
import { MOCK_LOCATION } from '@/services/quickNote/seed';
import type { StoreSetter } from '@/store/types';

import type { QuickNoteStore } from './store';

export const AUTO_TAG_DELAY = 2500;
export const DIVE_TICK = 30;
export const PERSIST_DEBOUNCE = 800;

type Setter = StoreSetter<QuickNoteStore>;

export class QuickNoteActionImpl {
  readonly #get: () => QuickNoteStore;
  readonly #set: Setter;
  readonly #autoTagTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(set: Setter, get: () => QuickNoteStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  initNotes = async () => {
    if (this.#get().notesInit) return;
    const notes = await quickNoteService.getNotes();
    this.#set({ notes, notesInit: true }, false, 'initNotes');
  };

  createNote = async (): Promise<string> => {
    const now = Date.now();
    const note: QuickNoteItem = {
      content: '',
      createdAt: now,
      id: nanoid(),
      location: MOCK_LOCATION,
      tags: [],
      updatedAt: now,
    };

    this.#set({ notes: [note, ...this.#get().notes] }, false, 'createNote');
    this.#persist();
    return note.id;
  };

  removeNote = (id: string) => {
    const { activeNoteId, notes } = this.#get();
    this.#set(
      {
        activeNoteId: activeNoteId === id ? undefined : activeNoteId,
        notes: notes.filter((note) => note.id !== id),
      },
      false,
      'removeNote',
    );
    this.#persist();
  };

  updateNoteContent = (id: string, content: string) => {
    const target = this.#get().notes.find((note) => note.id === id);
    if (!target || target.content === content) return;

    this.#set(
      {
        notes: this.#get().notes.map((note) =>
          note.id === id ? { ...note, content, updatedAt: Date.now() } : note,
        ),
        saveStatus: 'saving',
      },
      false,
      'updateNoteContent',
    );
    this.#persist();
    this.#scheduleAutoTag(id);
  };

  diveInto = (id: string) => {
    const { divingNoteIds, notes } = this.#get();
    if (divingNoteIds.includes(id)) return;

    const note = notes.find((item) => item.id === id);
    if (!note || !note.content.trim()) return;

    const full = mockGenerateAnnotation(note.content);
    this.#set({ divingNoteIds: [...divingNoteIds, id] }, false, 'diveInto/start');
    this.#patchNote(id, { annotation: { content: '' } });

    let cursor = 0;
    const timer = setInterval(() => {
      cursor += 2 + Math.floor(Math.random() * 3);
      const done = cursor >= full.length;
      this.#patchNote(id, {
        annotation: { content: full.slice(0, cursor), divedAt: done ? Date.now() : undefined },
      });

      if (done) {
        clearInterval(timer);
        this.#set(
          { divingNoteIds: this.#get().divingNoteIds.filter((item) => item !== id) },
          false,
          'diveInto/done',
        );
        this.#persist();
      }
    }, DIVE_TICK);
  };

  setActiveCollection = (collection: string | null) => {
    this.#set({ activeCollection: collection, activeTag: null }, false, 'setActiveCollection');
  };

  setActiveTag = (tag: string | null) => {
    this.#set({ activeCollection: null, activeTag: tag }, false, 'setActiveTag');
  };

  setSearchKeywords = (searchKeywords: string) => {
    this.#set({ searchKeywords }, false, 'setSearchKeywords');
  };

  toggleAnnotationPanel = (expand?: boolean) => {
    this.#set(
      { annotationPanelExpanded: expand ?? !this.#get().annotationPanelExpanded },
      false,
      'toggleAnnotationPanel',
    );
  };

  toggleListCollapsed = () => {
    this.#set({ listCollapsed: !this.#get().listCollapsed }, false, 'toggleListCollapsed');
  };

  #patchNote = (id: string, patch: Partial<QuickNoteItem>) => {
    this.#set(
      {
        notes: this.#get().notes.map((note) => (note.id === id ? { ...note, ...patch } : note)),
      },
      false,
      'patchNote',
    );
  };

  retrySave = () => {
    this.#set({ saveStatus: 'saving' }, false, 'retrySave');
    this.#persist();
    this.#persist.flush();
  };

  #persist = debounce(async () => {
    try {
      await quickNoteService.saveNotes(this.#get().notes);
      this.#set({ saveStatus: 'saved' }, false, 'persist');
    } catch {
      this.#set({ saveStatus: 'failed' }, false, 'persist/failed');
    }
  }, PERSIST_DEBOUNCE);

  #scheduleAutoTag = (id: string) => {
    const existing = this.#autoTagTimers.get(id);
    if (existing) clearTimeout(existing);

    this.#autoTagTimers.set(
      id,
      setTimeout(() => {
        this.#autoTagTimers.delete(id);
        const note = this.#get().notes.find((item) => item.id === id);
        if (!note || note.tags.length > 0 || !note.content.trim()) return;

        this.#patchNote(id, { tags: mockGenerateTags(note.content) });
        this.#persist();
      }, AUTO_TAG_DELAY),
    );
  };
}

export type QuickNoteAction = Pick<QuickNoteActionImpl, keyof QuickNoteActionImpl>;

export const createQuickNoteSlice = (set: Setter, get: () => QuickNoteStore, _api?: unknown) =>
  new QuickNoteActionImpl(set, get, _api);
