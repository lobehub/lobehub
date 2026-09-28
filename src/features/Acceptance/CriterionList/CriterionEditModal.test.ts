import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { openCriterionEditModal } from './CriterionEditModal';
import { CriterionEditor } from './CriterionEditor';

const mocks = vi.hoisted(() => ({ createModal: vi.fn((options) => options) }));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createModal: mocks.createModal,
}));

describe('openCriterionEditModal', () => {
  it('renders the title through react-i18next so a lazily loaded namespace can update it', () => {
    openCriterionEditModal({
      criterion: { required: true, title: 'Check result', verifierType: 'agent' },
      onSubmit: vi.fn(),
    });

    const options = mocks.createModal.mock.calls[0][0];

    expect(typeof options.title).not.toBe('string');
  });
});

describe('criterion modal persistence', () => {
  it('keeps the editor open until saving succeeds', async () => {
    let resolveSave!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const onClose = vi.fn();
    render(
      createElement(CriterionEditor, {
        initial: { title: 'Editable criterion', verifierType: 'agent' },
        onClose,
        onSubmit,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'criterion.save' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => resolveSave());
    expect(onClose).toHaveBeenCalledOnce();
  }, 20_000);
});
