import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import GroupSubmenu from '../GroupSubmenu';

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Popover: ({ children, content }: { children: ReactNode; content: ReactNode }) => (
    <div>
      {children}
      <div data-testid={'submenu'}>{content}</div>
    </div>
  ),
}));

describe('GroupSubmenu', () => {
  it('keeps one first-level row and hands its choices to the submenu', () => {
    render(
      <GroupSubmenu hint={'Persistent'} icon={null} label={'Sandboxes'} testId={'group'}>
        <div>choice:temporary</div>
      </GroupSubmenu>,
    );

    const row = screen.getByTestId('group');
    expect(row.textContent).toContain('Sandboxes');
    expect(row.textContent).toContain('Persistent');
    expect(row.textContent).not.toContain('choice:');

    const submenu = screen.getByTestId('submenu');
    expect(submenu.textContent).toContain('Sandboxes');
    expect(submenu.textContent).toContain('choice:temporary');
  });
});
