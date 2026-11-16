export const normalizeBranch = (branch?: string): string | undefined => {
  const value = branch?.trim();
  // A `$`/backtick here is an unexpanded shell construct, not a branch name.
  if (!value || value === '-' || /[$`]/.test(value)) return undefined;
  return value.includes(':') ? value.split(':').at(-1) : value;
};
