import { type StateCreator } from 'zustand/vanilla';

import type { ElectronStore } from '../store';

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

export interface NavigationHistoryAction {
  /**
   * Check if can go back in history
   */
  canGoBack: () => boolean;

  /**
   * Check if can go forward in history
   */
  canGoForward: () => boolean;

  /**
   * Get current history entry
   */
  getCurrentEntry: () => HistoryEntry | null;

  /**
   * Navigate back in history
   * @returns The target entry or null if cannot go back
   */
  goBack: () => HistoryEntry | null;

  /**
   * Navigate forward in history
   * @returns The target entry or null if cannot go forward
   */
  goForward: () => HistoryEntry | null;

  /**
   * Push a new entry to history (for normal navigation)
   * Truncates any forward history if not at the end
   */
  pushHistory: (
    entry: Omit<HistoryEntry, 'metadata'> & { metadata?: Partial<HistoryEntry['metadata']> },
  ) => void;

  /**
   * Replace current entry in history (for replace navigation)
   */
  replaceHistory: (
    entry: Omit<HistoryEntry, 'metadata'> & { metadata?: Partial<HistoryEntry['metadata']> },
  ) => void;

  /**
   * Set current page title (called by PageTitle component)
   */
  setCurrentPageTitle: (title: string) => void;

  /**
   * Set the navigating history flag
   */
  setIsNavigatingHistory: (value: boolean) => void;
}

// ======== Initial State ======== //

export const navigationHistoryInitialState: NavigationHistoryState = {
  currentPageTitle: '',
  historyCurrentIndex: -1,
  historyEntries: [],
  isNavigatingHistory: false,
};

// ======== Action Implementation ======== //

export const createNavigationHistorySlice: StateCreator<
  ElectronStore,
  [['zustand/devtools', never]],
  [],
  NavigationHistoryAction
> = (set, get) => ({
  canGoBack: () => {
    const { historyCurrentIndex } = get();
    return historyCurrentIndex > 0;
  },

  canGoForward: () => {
    const { historyCurrentIndex, historyEntries } = get();
    return historyCurrentIndex < historyEntries.length - 1;
  },

  getCurrentEntry: () => {
    const { historyCurrentIndex, historyEntries } = get();
    if (historyCurrentIndex < 0 || historyCurrentIndex >= historyEntries.length) {
      return null;
    }
    return historyEntries[historyCurrentIndex];
  },

  goBack: () => {
    const { historyCurrentIndex, historyEntries } = get();

    if (historyCurrentIndex <= 0) {
      return null;
    }

    const newIndex = historyCurrentIndex - 1;
    const targetEntry = historyEntries[newIndex];

    set(
      {
        historyCurrentIndex: newIndex,
        isNavigatingHistory: true,
      },
      false,
      'goBack',
    );

    return targetEntry;
  },

  goForward: () => {
    const { historyCurrentIndex, historyEntries } = get();

    if (historyCurrentIndex >= historyEntries.length - 1) {
      return null;
    }

    const newIndex = historyCurrentIndex + 1;
    const targetEntry = historyEntries[newIndex];

    set(
      {
        historyCurrentIndex: newIndex,
        isNavigatingHistory: true,
      },
      false,
      'goForward',
    );

    return targetEntry;
  },

  pushHistory: (entry) => {
    const { historyCurrentIndex, historyEntries } = get();

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

    set(
      {
        historyCurrentIndex: newEntries.length - 1,
        historyEntries: newEntries,
      },
      false,
      'pushHistory',
    );
  },

  replaceHistory: (entry) => {
    const { historyCurrentIndex, historyEntries } = get();

    // If history is empty, just push
    if (historyCurrentIndex < 0 || historyEntries.length === 0) {
      get().pushHistory(entry);
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

    set(
      {
        historyEntries: newEntries,
      },
      false,
      'replaceHistory',
    );
  },

  setCurrentPageTitle: (title) => {
    set({ currentPageTitle: title }, false, 'setCurrentPageTitle');
  },

  setIsNavigatingHistory: (value) => {
    set({ isNavigatingHistory: value }, false, 'setIsNavigatingHistory');
  },
});
