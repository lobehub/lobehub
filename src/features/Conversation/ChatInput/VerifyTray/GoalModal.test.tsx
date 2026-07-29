import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoalContent } from './GoalModal';

const mocks = vi.hoisted(() => ({ close: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('i18next', () => ({ t: (key: string) => key }));
vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  TextArea: (props: any) => <textarea {...props} />,
}));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  createModal: vi.fn(),
  useModalContext: () => ({ close: mocks.close }),
}));

const DELETE_LABEL = 'acceptance.tray.goalModal.delete';

describe('GoalContent delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the modal open when the delete write fails (rolled back by the caller)', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('offline'));
    render(<GoalContent initialGoal="g" onDelete={onDelete} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByText(DELETE_LABEL));

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    // The rejection is awaited and swallowed — the modal stays open instead of
    // closing on a rolled-back delete (and no unhandled rejection escapes).
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it('closes only after the delete write lands', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<GoalContent initialGoal="g" onDelete={onDelete} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByText(DELETE_LABEL));

    await waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
