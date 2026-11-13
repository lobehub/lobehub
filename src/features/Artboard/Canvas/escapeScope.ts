export const ownsEscape = (event: KeyboardEvent, root: Element | null) => {
  if (event.key !== 'Escape' || event.isComposing) return false;
  const target = event.target as Node | null;
  return !target || target === document.body || !!root?.contains(target);
};
