import { describe, expect, it } from 'vitest';

import { createStore } from '.';

describe('PageEditorStore - rightPanelMode', () => {
  it('should default to copilot mode', () => {
    const store = createStore();

    expect(store.getState().rightPanelMode).toBe('copilot');
  });

  it('should switch to history mode', () => {
    const store = createStore();

    store.getState().setRightPanelMode('history');

    expect(store.getState().rightPanelMode).toBe('history');
  });
});
