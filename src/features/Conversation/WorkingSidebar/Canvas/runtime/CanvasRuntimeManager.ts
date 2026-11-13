import type { CanvasRuntimeBundle } from '@lobechat/canvas/runtime';

import type { CanvasRuntimeEntry, CanvasRuntimeSource } from './CanvasRuntimeSource';

export class CanvasRuntimeManager {
  private current?: {
    controller: AbortController;
    pending: Map<CanvasRuntimeEntry, Promise<CanvasRuntimeBundle>>;
    references: number;
    source: CanvasRuntimeSource;
  };

  constructor(private create: (signal: AbortSignal) => CanvasRuntimeSource) {}

  acquire() {
    if (!this.current) {
      const controller = new AbortController();
      const state = {
        controller,
        pending: new Map<CanvasRuntimeEntry, Promise<CanvasRuntimeBundle>>(),
        references: 0,
        source: this.create(controller.signal),
      };
      this.current = state;
    }
    const state = this.current;
    state.references++;
    let released = false;
    const load = (entry: CanvasRuntimeEntry) => {
      if (released) return Promise.reject(new Error('Canvas runtime released'));
      let pending = state.pending.get(entry);
      if (!pending) {
        pending = state.source.load(entry).catch((error) => {
          state.pending.delete(entry);
          throw error;
        });
        state.pending.set(entry, pending);
      }
      return pending;
    };
    return {
      ready: load('runtime'),
      loadAddon: (name: 'highlight' | 'mermaid') => load(name),
      release: () => {
        if (released) return;
        released = true;
        if (--state.references > 0) return;
        if (this.current === state) this.current = undefined;
        state.controller.abort();
        state.source.dispose();
        state.pending.clear();
      },
    };
  }
}
