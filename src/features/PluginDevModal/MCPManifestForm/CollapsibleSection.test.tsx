import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import CollapsibleSection from './CollapsibleSection';

describe('CollapsibleSection', () => {
  it('is reachable and toggled from the keyboard, announcing its state', async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection title="Advanced Settings">
        <input aria-label="Client ID" />
      </CollapsibleSection>,
    );

    const trigger = screen.getByRole('button', { name: 'Advanced Settings' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Client ID')).toBeNull();

    await user.tab();
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('region', { name: 'Advanced Settings' });
    expect(trigger).toHaveAttribute('aria-controls', panel.id);

    await user.tab();
    expect(screen.getByLabelText('Client ID')).toHaveFocus();

    await user.tab({ shift: true });
    expect(trigger).toHaveFocus();

    await user.keyboard(' ');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Client ID')).toBeNull();
  });

  it('does not submit the surrounding form when toggled', async () => {
    const user = userEvent.setup();
    let submitted = false;
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted = true;
        }}
      >
        <CollapsibleSection title="Advanced Settings">
          <span>content</span>
        </CollapsibleSection>
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'Advanced Settings' }));

    expect(screen.getByText('content')).toBeInTheDocument();
    expect(submitted).toBe(false);
  });
});
