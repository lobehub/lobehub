const textInputTypes = new Set(['email', 'number', 'password', 'search', 'tel', 'text', 'url']);

const applyDefault = (element: Element) => {
  if (
    !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) ||
    (element instanceof HTMLInputElement && !textInputTypes.has(element.type))
  )
    return;

  // Some Select libraries use a password hint for their ordinary search input.
  const isSelectSearch =
    element instanceof HTMLInputElement &&
    element.type !== 'password' &&
    element.getAttribute('role') === 'combobox' &&
    element.autocomplete === 'new-password';

  if (
    !isSelectSearch &&
    (element.hasAttribute('autocomplete') || element.form?.hasAttribute('autocomplete'))
  )
    return;

  // Auth fields and form-level opt-ins keep their explicit browser semantics.
  element.autocomplete = 'off';
};

const scan = (root: Element) => {
  applyDefault(root);
  root.querySelectorAll('input, textarea').forEach(applyDefault);
};

/** Keep browser history suggestions out of business inputs, including portal searches. */
export const installFormAutocompleteDefaults = () => {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) scan(node);
      }
    }
  });

  // Observe only inserted subtrees, never every keystroke or attribute change.
  observer.observe(document.body, { childList: true, subtree: true });
  scan(document.body);

  // React autoFocus may run before the observer's microtask.
  // Each installation owns its listener so cleanup cannot remove another listener.
  const onFocus = (event: FocusEvent) => {
    if (event.target instanceof Element) applyDefault(event.target);
  };
  document.addEventListener('focus', onFocus, true);

  return () => {
    observer.disconnect();
    document.removeEventListener('focus', onFocus, true);
  };
};
