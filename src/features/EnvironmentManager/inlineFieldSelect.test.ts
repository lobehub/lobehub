import { describe, expect, it, vi } from 'vitest';

import { getInlineFieldSelectProps } from './inlineFieldSelect';

const emptyLabel = 'Repository default branch';

describe('inline field selection', () => {
  it('lets a named branch return to the repository default', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const props = getInlineFieldSelectProps(
      'beta',
      { emptyLabel, options: ['master', 'beta'] },
      save,
    );
    const defaultOption = props.options.find((option) => option.label === emptyLabel);

    expect(defaultOption).toBeDefined();
    props.onChange(defaultOption!.value);
    expect(save).toHaveBeenCalledWith('');
  });

  it('keeps the default selected when reopened, including an empty branch list', () => {
    const props = getInlineFieldSelectProps('', { emptyLabel, options: [] }, vi.fn());
    expect(props.options).toContainEqual({ label: emptyLabel, value: props.value });
  });

  it('preserves a branch missing from the fetched list and saves named branches', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const props = getInlineFieldSelectProps(
      'release/custom',
      { emptyLabel, options: ['master'] },
      save,
    );
    expect(props.options).toContainEqual({ label: 'release/custom', value: 'release/custom' });
    props.onChange('master');
    expect(save).toHaveBeenCalledWith('master');
    props.onChange(null);
    props.onChange(undefined);
    props.onChange(['master']);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does not add an empty choice to other selectors', () => {
    const props = getInlineFieldSelectProps('', { options: ['one'] }, vi.fn());
    expect(props.options).toEqual([{ label: 'one', value: 'one' }]);
    expect(props.value).toBeNull();
  });
});
