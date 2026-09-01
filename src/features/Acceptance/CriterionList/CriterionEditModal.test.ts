import { describe, expect, it, vi } from 'vitest';

import { openCriterionEditModal } from './CriterionEditModal';

const mocks = vi.hoisted(() => ({ createModal: vi.fn((options) => options) }));

vi.mock('@lobehub/ui', () => ({
  Flexbox: () => null,
  Input: () => null,
  Text: () => null,
  TextArea: () => null,
}));

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
