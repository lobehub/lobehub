export interface InlineFieldSelectConfig {
  /** A selectable empty value, such as the repository default branch. */
  emptyLabel?: string;
  loading?: boolean;
  options: string[];
}

// Select normalizes an empty string to undefined. A number cannot collide
// with the string options and keeps the default choice visibly selected.
const emptyValue = 0;

export const getInlineFieldSelectProps = (
  current: string,
  select: InlineFieldSelectConfig,
  onSave: (value: string) => Promise<void>,
) => ({
  onChange: (next: string | number | (string | number)[] | null | undefined) => {
    if (next === emptyValue && select.emptyLabel !== undefined) void onSave('');
    else if (typeof next === 'string' && next) void onSave(next);
  },
  options: [
    ...(select.emptyLabel === undefined ? [] : [{ label: select.emptyLabel, value: emptyValue }]),
    ...(current && !select.options.includes(current)
      ? [current, ...select.options]
      : select.options
    ).map((name) => ({ label: name, value: name })),
  ],
  value: current || (select.emptyLabel === undefined ? null : emptyValue),
});
