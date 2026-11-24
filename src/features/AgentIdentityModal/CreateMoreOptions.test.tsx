import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CreateMoreOptions from './CreateMoreOptions';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const renderOptions = (error?: string) =>
  render(
    <CreateMoreOptions error={error}>
      <input aria-label={'slug'} />
    </CreateMoreOptions>,
  );

describe('CreateMoreOptions', () => {
  it('starts collapsed and expands from its header', () => {
    renderOptions();

    expect(screen.queryByLabelText('slug')).toBeNull();

    fireEvent.click(screen.getByText('settingAgent.identity.moreOptions'));

    expect(screen.getByLabelText('slug')).toBeTruthy();
  });

  it('opens when a field error appears, so the error is not hidden', () => {
    const { rerender } = renderOptions();
    expect(screen.queryByLabelText('slug')).toBeNull();

    rerender(
      <CreateMoreOptions error={'Slug taken'}>
        <input aria-label={'slug'} />
      </CreateMoreOptions>,
    );

    expect(screen.getByLabelText('slug')).toBeTruthy();
  });

  it('opens again for the same error after it was cleared and folded away', () => {
    const { rerender } = renderOptions('Slug taken');
    expect(screen.getByLabelText('slug')).toBeTruthy();

    rerender(
      <CreateMoreOptions>
        <input aria-label={'slug'} />
      </CreateMoreOptions>,
    );
    fireEvent.click(screen.getByText('settingAgent.identity.moreOptions'));
    expect(screen.queryByLabelText('slug')).toBeNull();

    rerender(
      <CreateMoreOptions error={'Slug taken'}>
        <input aria-label={'slug'} />
      </CreateMoreOptions>,
    );
    expect(screen.getByLabelText('slug')).toBeTruthy();
  });
});
