import { create } from 'zustand';

interface EntityTrailState {
  clear: () => void;
  /** Pages left by following links, so the header can offer a way back. */
  history: string[];
  pop: () => string | undefined;
  push: (id: string) => void;
}

/**
 * The way back only. Which page is open lives in the URL (`?contextId=`, see `useSelection`),
 * so memory deep links, reloads and browser back all land on the same page.
 */
export const useEntityTrailStore = create<EntityTrailState>()((set, get) => ({
  clear: () => set({ history: [] }),
  history: [],
  pop: () => {
    const history = get().history;
    const last = history.at(-1);
    set({ history: history.slice(0, -1) });
    return last;
  },
  push: (id) => set((s) => ({ history: [...s.history, id] })),
}));
