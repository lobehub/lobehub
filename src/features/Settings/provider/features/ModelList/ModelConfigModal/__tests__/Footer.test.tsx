import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ModelConfigFooter from '../Footer';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  error: vi.fn(),
  updateAiModelsConfig: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, loading, onClick }: any) => (
    <button data-loading={String(!!loading)} onClick={onClick}>
      {children}
    </button>
  ),
  ModalFooter: ({ children }: any) => <div>{children}</div>,
  toast: { error: mocks.error },
  useModalContext: () => ({ close: mocks.close }),
}));

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: (s: any) => unknown) =>
    selector({
      activeAiProvider: 'openai',
      updateAiModelsConfig: mocks.updateAiModelsConfig,
    }),
}));

const formValues = { config: null, displayName: 'GPT', id: 'gpt-4o' };
const formRef = { current: { getValues: () => formValues } as any };

describe('ModelConfigFooter', () => {
  beforeEach(() => {
    mocks.close.mockReset();
    mocks.error.mockReset();
    mocks.updateAiModelsConfig.mockReset();
  });

  it('submits form values and closes the modal on success', async () => {
    mocks.updateAiModelsConfig.mockResolvedValue(undefined);

    render(<ModelConfigFooter formRef={formRef} id="gpt-4o" />);
    fireEvent.click(screen.getByText('ok'));

    await waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
    expect(mocks.updateAiModelsConfig).toHaveBeenCalledWith('gpt-4o', 'openai', formValues);
    expect(screen.getByText('ok').dataset.loading).toBe('false');
  });

  it('clears loading and keeps the modal open when saving rejects', async () => {
    mocks.updateAiModelsConfig.mockRejectedValue(new Error('400 Bad Request'));

    render(<ModelConfigFooter formRef={formRef} id="gpt-4o" />);
    const okButton = screen.getByText('ok');
    fireEvent.click(okButton);

    await waitFor(() => expect(mocks.updateAiModelsConfig).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(okButton.dataset.loading).toBe('false'));
    expect(mocks.close).not.toHaveBeenCalled();

    expect(mocks.error).toHaveBeenCalledWith('operationFailed');
  });
});
