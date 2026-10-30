/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RenameInput from './RenameInput';

const renamePage = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/page', () => ({
  pageActions: { renamePage },
}));

describe('Docs page rename field', () => {
  beforeEach(() => {
    renamePage.mockClear();
  });

  it('stays open when focus is taken away from the row', () => {
    // The row menu hands focus back to its trigger after the field mounts. A
    // blur-commit closed the field here, which is what made "Rename" look dead.
    const onDone = vi.fn();
    render(<RenameInput id={'page-1'} title={'Weekly report'} onDone={onDone} />);

    fireEvent.blur(screen.getByTestId('page-rename-input'));

    expect(onDone).not.toHaveBeenCalled();
    expect(renamePage).not.toHaveBeenCalled();
    expect(screen.getByTestId('page-rename-input')).toBeTruthy();
  });

  it('commits the typed title when the pointer lands outside the row', async () => {
    const onDone = vi.fn();
    render(<RenameInput id={'page-1'} title={'Weekly report'} onDone={onDone} />);

    fireEvent.change(screen.getByTestId('page-rename-input'), {
      target: { value: 'Renamed report' },
    });
    fireEvent.pointerDown(document.body);

    expect(renamePage).toHaveBeenCalledWith('page-1', 'Renamed report');
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('keeps the field open for a pointer landing inside it', () => {
    const onDone = vi.fn();
    render(<RenameInput id={'page-1'} title={'Weekly report'} onDone={onDone} />);

    const input = screen.getByTestId('page-rename-input');
    fireEvent.pointerDown(input);

    expect(onDone).not.toHaveBeenCalled();
  });

  it('does not write when the title is unchanged', async () => {
    const onDone = vi.fn();
    render(<RenameInput id={'page-1'} title={'Weekly report'} onDone={onDone} />);

    fireEvent.pointerDown(document.body);

    expect(renamePage).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
