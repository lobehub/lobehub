import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Checker from './Checker';

const fetchPresetTaskResult = vi.fn();

vi.mock('@/services/chat', () => ({
  chatService: { fetchPresetTaskResult: (...args: any[]) => fetchPresetTaskResult(...args) },
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true, reason: '' }),
}));

vi.mock('@/hooks/useProviderName', () => ({
  useProviderName: (provider?: string) => provider,
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: { getAiProviderModelList: () => () => [] },
  aiProviderSelectors: { isProviderConfigUpdating: () => () => false },
  useAiInfraStore: (selector: (state: any) => unknown) =>
    selector({ updateAiProviderConfig: vi.fn() }),
}));

describe('Checker', () => {
  beforeEach(() => {
    fetchPresetTaskResult.mockReset();
  });

  // A provider error that arrives inside a 200 stream (a relayed device call, or
  // any in-stream provider error) reaches onError and then onFinish with no
  // text. The provider's own error must stay on screen, not be replaced by the
  // generic "empty response" connection-check failure.
  it('keeps the provider error when the stream also finishes empty', async () => {
    const providerError = {
      body: {
        error: { message: "model 'gpt-oss:20b' not found" },
        errorType: 'OllamaBizError',
        provider: 'ollama',
      },
      message: "model 'gpt-oss:20b' not found",
      type: 'OllamaBizError',
    };
    fetchPresetTaskResult.mockImplementation(async ({ onError, onFinish }) => {
      onError(new Error(providerError.message), providerError);
      await onFinish('');
    });
    const checkErrorRender = vi.fn(({ error }) => <div>{`render:${error?.type}`}</div>);

    render(
      <Checker
        checkErrorRender={checkErrorRender}
        model="gpt-oss:20b"
        provider="ollama"
        onAfterCheck={async () => {}}
        onBeforeCheck={async () => true}
      />,
    );

    await act(async () => {
      await userEvent.click(screen.getByRole('button'));
    });

    expect(await screen.findByText('render:OllamaBizError')).toBeInTheDocument();
    expect(screen.queryByText('render:ConnectionCheckFailed')).not.toBeInTheDocument();
  });
});
