// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFormAutocompleteDefaults } from './installFormAutocompleteDefaults';

describe('installFormAutocompleteDefaults', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.body.replaceChildren();
  });

  it('disables browser completion without changing values or combobox semantics', () => {
    document.body.innerHTML =
      '<input value="模型" aria-autocomplete="list"><textarea>备注</textarea>';
    cleanup = installFormAutocompleteDefaults();

    expect(document.querySelector('input')?.autocomplete).toBe('off');
    expect(document.querySelector('input')?.value).toBe('模型');
    expect(document.querySelector('input')?.getAttribute('aria-autocomplete')).toBe('list');
    expect(document.querySelector('textarea')?.autocomplete).toBe('off');
    expect(document.querySelector('textarea')?.value).toBe('备注');
  });

  it('preserves explicit account, password, verification and form policies', () => {
    document.body.innerHTML = `
      <input autocomplete="username"><input autocomplete="email">
      <input type="password" autocomplete="current-password">
      <input type="password" autocomplete="new-password">
      <input autocomplete="one-time-code">
      <form id="account" autocomplete="on"><input id="account-name"></form>
      <input form="account" id="associated-email">
    `;
    cleanup = installFormAutocompleteDefaults();

    expect(
      [...document.querySelectorAll('input[autocomplete]')].map((input) =>
        input.getAttribute('autocomplete'),
      ),
    ).toEqual(['username', 'email', 'current-password', 'new-password', 'one-time-code']);
    expect(document.querySelector('#account-name')?.hasAttribute('autocomplete')).toBe(false);
    expect(document.querySelector('#associated-email')?.hasAttribute('autocomplete')).toBe(false);
  });

  it('disables password-manager hints on select searches without changing keyboard semantics', () => {
    document.body.innerHTML =
      '<input role="combobox" autocomplete="new-password" aria-autocomplete="list" aria-controls="options">';
    cleanup = installFormAutocompleteDefaults();

    const input = document.querySelector('input');
    expect(input?.autocomplete).toBe('off');
    expect(input?.getAttribute('role')).toBe('combobox');
    expect(input?.getAttribute('aria-autocomplete')).toBe('list');
    expect(input?.getAttribute('aria-controls')).toBe('options');
  });

  it('covers dynamically mounted portal inputs before they are focused', async () => {
    cleanup = installFormAutocompleteDefaults();
    const popup = document.createElement('div');
    popup.innerHTML = '<input type="search"><textarea></textarea>';
    document.body.append(popup);

    await vi.waitFor(() => {
      expect(popup.querySelector('input')?.autocomplete).toBe('off');
      expect(popup.querySelector('textarea')?.autocomplete).toBe('off');
    });
  });

  it('handles immediate autofocus before the mutation observer runs', () => {
    cleanup = installFormAutocompleteDefaults();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    expect(input.autocomplete).toBe('off');
  });

  it('leaves non-text controls alone', () => {
    document.body.innerHTML =
      '<input type="file"><input type="checkbox"><input type="radio"><button>确认</button>';
    cleanup = installFormAutocompleteDefaults();

    expect(document.querySelector('[autocomplete]')).toBeNull();
  });

  it('disconnects observation and focus handling on cleanup', async () => {
    cleanup = installFormAutocompleteDefaults();
    cleanup();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(input.hasAttribute('autocomplete')).toBe(false);
  });
});
