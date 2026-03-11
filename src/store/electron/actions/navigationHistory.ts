import { type StoreSetter } from '@/store/types';

import { type ElectronStore } from '../store';

// ======== Types ======== //

export interface HistoryEntry {
  icon?: string;
  metadata?: {
    [key: string]: any;
    sessionId?: string;
    timestamp: number;
  };
  title: string;
  url: string;
}

export interface NavigationHistoryState {
  /**
   * Current page title from PageTitle component
   * Used to get dynamic titles without setTimeout hack
   */
  currentPageTitle: string;
  /**
   * Current position in history (-1 means empty)
   */
  historyCurrentIndex: number;
  /**
   * History entries list
   */
  historyEntries: HistoryEntry[];
  /**
   * Flag to indicate if currently navigating via back/forward
   * Used to prevent adding duplicate history entries
   */
  isNavigatingHistory: boolean;
}

// ======== Action Interface ======== //

// ======== Initial State ======== //

export const navigationHistoryInitialState: NavigationHistoryState = {
  currentPageTitle: '',
  historyCurrentIndex: -1,
  historyEntries: [],
  isNavigatingHistory: false,
};

// ======== Action Implementation ======== //

type Setter = StoreSetter<ElectronStore>;
export const createNavigationHistorySlice = (
  set: Setter,
  get: () => ElectronStore,
  _api?: unknown,
) => new NavigationHistoryActionImpl(set, get, _api);

export class NavigationHistoryActionImpl {
  readonly #get: () => ElectronStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ElectronStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  canGoBack = (): boolean => {
    const { historyCurrentIndex } = this.#get();
    return historyCurrentIndex > 0;
  };

  canGoForward = (): boolean => {
    const { historyCurrentIndex, historyEntries } = this.#get();
    return historyCurrentIndex < historyEntries.length - 1;
  };

  getCurrentEntry = (): HistoryEntry | null => {
    const { historyCurrentIndex, historyEntries } = this.#get();
    if (historyCurrentIndex < 0 || historyCurrentIndex >= historyEntries.length) {
      return null;
    }
    return historyEntries[historyCurrentIndex];
  };

  goBack = (): HistoryEntry | null => {
    const { historyCurrentIndex, historyEntries } = this.#get();

    if (historyCurrentIndex <= 0) {
      return null;
    }

    const newIndex = historyCurrentIndex - 1;
    const targetEntry = historyEntries[newIndex];

    this.#set(
      {
        historyCurrentIndex: newIndex,
        isNavigatingHistory: true,
      },
      false,
      'goBack',
    );

    return targetEntry;
  };

  goForward = (): HistoryEntry | null => {
    const { historyCurrentIndex, historyEntries } = this.#get();

    if (historyCurrentIndex >= historyEntries.length - 1) {
      return null;
    }

    const newIndex = historyCurrentIndex + 1;
    const targetEntry = historyEntries[newIndex];

    this.#set(
      {
        historyCurrentIndex: newIndex,
        isNavigatingHistory: true,
      },
      false,
      'goForward',
    );

    return targetEntry;
  };

  pushHistory = (
    entry: Omit<HistoryEntry, 'metadata'> & { metadata?: Partial<HistoryEntry['metadata']> },
  ): void => {
    const { historyCurrentIndex, historyEntries } = this.#get();

    // Create full entry with metadata
    const fullEntry: HistoryEntry = {
      icon: entry.icon,
      metadata: {
        timestamp: Date.now(),
        ...entry.metadata,
      },
      title: entry.title,
      url: entry.url,
    };

    // If not at the end, truncate forward history
    const newEntries =
      historyCurrentIndex < historyEntries.length - 1
        ? historyEntries.slice(0, historyCurrentIndex + 1)
        : [...historyEntries];

    // Add new entry
    newEntries.push(fullEntry);

    this.#set(
      {
        historyCurrentIndex: newEntries.length - 1,
        historyEntries: newEntries,
      },
      false,
      'pushHistory',
    );
  };

  replaceHistory = (
    entry: Omit<HistoryEntry, 'metadata'> & { metadata?: Partial<HistoryEntry['metadata']> },
  ): void => {
    const { historyCurrentIndex, historyEntries } = this.#get();

    // If history is empty, just push
    if (historyCurrentIndex < 0 || historyEntries.length === 0) {
      this.#get().pushHistory(entry);
      return;
    }

    // Create full entry with metadata
    const fullEntry: HistoryEntry = {
      icon: entry.icon,
      metadata: {
        timestamp: Date.now(),
        ...entry.metadata,
      },
      title: entry.title,
      url: entry.url,
    };

    // Replace current entry
    const newEntries = [...historyEntries];
    newEntries[historyCurrentIndex] = fullEntry;

    this.#set(
      {
        historyEntries: newEntries,
      },
      false,
      'replaceHistory',
    );
  };

  setCurrentPageTitle = (title: string): void => {
    this.#set({ currentPageTitle: title }, false, 'setCurrentPageTitle');
  };

  setIsNavigatingHistory = (value: boolean): void => {
    this.#set({ isNavigatingHistory: value }, false, 'setIsNavigatingHistory');
  };
}

export type NavigationHistoryAction = Pick<
  NavigationHistoryActionImpl,
  keyof NavigationHistoryActionImpl
>;
