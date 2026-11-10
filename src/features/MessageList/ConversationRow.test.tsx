/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ConversationRow from './ConversationRow';

const navigate = vi.fn();

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ to, ...rest }: { to: string }) => createElement('a', { href: to, ...rest }),
}));

const renderRow = (active: boolean, onClick = vi.fn(), closeOnReselect = true) => {
  render(
    createElement(ConversationRow, {
      active,
      avatar: null,
      closeOnReselect,
      onClick,
      title: 'Dario',
      url: '/channels/chn_dario',
    }),
  );
  return { onClick, row: screen.getByRole('link', { name: 'Dario' }) };
};

describe('ConversationRow', () => {
  beforeEach(() => navigate.mockClear());

  it('closes the open conversation when it is clicked again', () => {
    const { onClick, row } = renderRow(true);

    const event = new MouseEvent('click', { bubbles: true, button: 0, cancelable: true });
    fireEvent(row, event);

    expect(event.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('opens an inactive conversation through its own click handling', () => {
    const { onClick, row } = renderRow(false);

    fireEvent.click(row);

    expect(navigate).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // Directory rows (the contacts tab) open a profile, so a second click must not leave it.
  it('keeps the open row selected when it does not close on reselect', () => {
    const { onClick, row } = renderRow(true, vi.fn(), false);

    fireEvent.click(row);

    expect(navigate).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('leaves a modified click on the open conversation to the link', () => {
    const { row } = renderRow(true);

    fireEvent.click(row, { metaKey: true });

    expect(navigate).not.toHaveBeenCalled();
  });

  // A row with no chat yet kept a blank preview line, so its title sat high instead of centered.
  it('leaves out the preview line when there is no preview', () => {
    const { row } = renderRow(false);

    expect(row.textContent).toBe('Dario');
  });
});
