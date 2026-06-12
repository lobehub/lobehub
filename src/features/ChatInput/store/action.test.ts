import { describe, expect, it } from 'vitest';

import { createStore, selectors } from '.';

describe('ChatInput store actions', () => {
  it('clears the autocomplete breaker when dismissing its error', () => {
    const store = createStore();

    store.getState().pauseInputCompletion({ message: 'InsufficientBudgetForModel' });

    expect(selectors.inputCompletionPaused(store.getState())).toBe(true);

    store.getState().dismissInputCompletionError();

    expect(store.getState().inputCompletionError).toBeUndefined();
    expect(selectors.inputCompletionPaused(store.getState())).toBe(false);
    expect(selectors.inputCompletionErrorVisible(store.getState())).toBeUndefined();
  });
});
