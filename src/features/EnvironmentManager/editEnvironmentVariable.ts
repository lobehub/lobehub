type Entry = [string, string];

/** Reject key collisions before the saved object can collapse duplicate entries. */
export const editEnvironmentVariable = (
  entries: Entry[],
  next: Entry,
  previousKey?: string,
): Entry[] | undefined => {
  if (entries.some(([key]) => key === next[0] && key !== previousKey)) return;

  return previousKey === undefined
    ? [...entries, next]
    : entries.map((entry) => (entry[0] === previousKey ? next : entry));
};
