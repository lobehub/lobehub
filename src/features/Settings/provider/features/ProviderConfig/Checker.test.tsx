import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Checker from './Checker';

const fetchPresetTaskResult = vi.fn();
const checkProviderConnectivity = vi.fn();

vi.mock('@/services/aiProvider', () => ({
  aiProviderService: {
    checkProviderConnectivity: (...args: any[]) => checkProviderConnectivity(...args),
  },
}));

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
    checkProviderConnectivity.mockReset();
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

  describe('credentials check mode', () => {
    const renderCredentialsChecker = (onBeforeCheck = async () => true) => {
      const checkErrorRender = vi.fn(({ error }) => (
        <div>{`render:${error?.type}:${error?.message}`}</div>
      ));
      render(
        <Checker
          checkErrorRender={checkErrorRender}
          checkMode="credentials"
          model=""
          provider="fal"
          onAfterCheck={async () => {}}
          onBeforeCheck={onBeforeCheck}
        />,
      );
    };

    it('hides the check-model picker and verifies the key on the server', async () => {
      checkProviderConnectivity.mockResolvedValue({ balance: 100, ok: true });
      renderCredentialsChecker();

      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

      await act(async () => {
        await userEvent.click(screen.getByRole('button'));
      });

      expect(checkProviderConnectivity).toHaveBeenCalledWith('fal');
      expect(fetchPresetTaskResult).not.toHaveBeenCalled();
      expect(await screen.findByText('llm.checker.pass')).toBeInTheDocument();
    });

    it('shows the rejected-key error type and gateway message', async () => {
      checkProviderConnectivity.mockResolvedValue({
        error: 'InvalidProviderAPIKey: Unauthorized',
        errorType: 'InvalidProviderAPIKey',
        ok: false,
      });
      renderCredentialsChecker();

      await act(async () => {
        await userEvent.click(screen.getByRole('button'));
      });

      expect(
        await screen.findByText('render:InvalidProviderAPIKey:InvalidProviderAPIKey: Unauthorized'),
      ).toBeInTheDocument();
      expect(screen.queryByText('llm.checker.pass')).not.toBeInTheDocument();
    });

    it('falls back to ConnectionCheckFailed when the request itself fails', async () => {
      checkProviderConnectivity.mockRejectedValue(new Error('network down'));
      renderCredentialsChecker();

      await act(async () => {
        await userEvent.click(screen.getByRole('button'));
      });

      expect(
        await screen.findByText('render:ConnectionCheckFailed:network down'),
      ).toBeInTheDocument();
    });

    it('does not check when the form is invalid', async () => {
      renderCredentialsChecker(async () => false);

      await act(async () => {
        await userEvent.click(screen.getByRole('button'));
      });

      expect(checkProviderConnectivity).not.toHaveBeenCalled();
    });
  });
});
