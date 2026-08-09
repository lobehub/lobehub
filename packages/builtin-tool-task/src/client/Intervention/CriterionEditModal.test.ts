import { describe, expect, it, vi } from 'vitest';

import { openCriterionEditModal } from './CriterionEditModal';

const mocks = vi.hoisted(() => ({ createModal: vi.fn((options) => options) }));

vi.mock('@lobehub/ui', () => ({
  Flexbox: () => null,
  Input: () => null,
  Text: () => null,
  TextArea: () => null,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: () => null,
  Select: () => null,
  Switch: () => null,
  createModal: mocks.createModal,
  useModalContext: () => ({ close: vi.fn() }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('openCriterionEditModal', () => {
  it('renders the title through react-i18next so a lazily loaded namespace can update it', () => {
    openCriterionEditModal({
      criterion: { required: true, title: 'Check result', verifierType: 'agent' },
      onSubmit: vi.fn(),
      seq: 2,
    });

    const options = mocks.createModal.mock.calls[0][0];

    expect(typeof options.title).not.toBe('string');
  });
});
