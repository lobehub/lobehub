import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SelectableTaskRow from './SelectableTaskRow';
import { useTaskSelectionStore } from './store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { task?: string }) =>
      key === 'taskList.bulk.selectTask' ? `Select ${options?.task}` : key,
  }),
}));

afterEach(() => useTaskSelectionStore.getState().clear());

describe('SelectableTaskRow', () => {
  it('names each checkbox after its task for assistive technology', () => {
    render(
      <>
        <SelectableTaskRow id="t1" label="T-1 Fix login" order={() => ['t1', 't2']}>
          <div>row 1</div>
        </SelectableTaskRow>
        <SelectableTaskRow id="t2" label="T-2 Ship docs" order={() => ['t1', 't2']}>
          <div>row 2</div>
        </SelectableTaskRow>
      </>,
    );

    expect(screen.getByRole('checkbox', { name: 'Select T-1 Fix login' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Select T-2 Ship docs' })).toBeTruthy();
  });

  it('marks the whole row selected when its checkbox is ticked', () => {
    const { container } = render(
      <SelectableTaskRow id="t1" label="T-1 Fix login" order={() => ['t1']}>
        <div>row 1</div>
      </SelectableTaskRow>,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.dataset.selected).toBeUndefined();

    fireEvent.click(screen.getByTestId('task-row-checkbox'));

    expect(row.dataset.selected).toBe('true');
    expect(
      screen.getByRole('checkbox', { name: 'Select T-1 Fix login' }).getAttribute('aria-checked'),
    ).toBe('true');
  });
});
