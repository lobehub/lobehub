import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Checker from './Checker';

const fetchPresetTaskResult = vi.fn();
const modelState = vi.hoisted(() => ({ models: [] as any[] }));

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
  aiModelSelectors: { getAiProviderModelList: () => () => modelState.models },
  aiProviderSelectors: { isProviderConfigUpdating: () => () => false },
  useAiInfraStore: (selector: (state: any) => unknown) =>
    selector({ updateAiProviderConfig: vi.fn() }),
}));

describe('Checker', () => {
  beforeEach(() => {
    modelState.models = [];
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

  it('uses a key-scoped model when the provider default is unavailable', async () => {
    modelState.models = [{ enabled: true, id: 'jzs-max-3.0', type: 'chat' }];
    fetchPresetTaskResult.mockImplementation(async ({ onFinish }) => {
      await onFinish('ok');
    });

    render(
      <Checker
        model="gpt-5.6-terra"
        provider="jzstoken"
        onAfterCheck={async () => {}}
        onBeforeCheck={async () => true}
      />,
    );

    await act(async () => {
      await userEvent.click(screen.getByRole('button'));
    });

    expect(fetchPresetTaskResult).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          model: 'jzs-max-3.0',
          provider: 'jzstoken',
        }),
      }),
    );
    expect(screen.getByRole('button', { name: 'llm.checker.pass' })).toBeInTheDocument();
  });

  const renderChecker = (model = 'custom-model') => (
    <Checker
      checkErrorRender={({ error }) => <div>{error ? `render:${error.type}` : 'clear'}</div>}
      model={model}
      provider="jzstoken"
      onAfterCheck={async () => {}}
      onBeforeCheck={async () => true}
    />
  );

  it('clears the previous probe when the check model falls back', async () => {
    modelState.models = [
      { enabled: true, id: 'custom-model', type: 'chat' },
      { enabled: true, id: 'jzs-max-3.0', type: 'chat' },
    ];
    fetchPresetTaskResult.mockImplementation(async ({ onFinish }) => {
      await onFinish('ok');
    });

    const view = render(renderChecker());

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'llm.checker.button' }));
    });

    expect(screen.getByRole('button', { name: 'llm.checker.pass' })).toBeInTheDocument();

    modelState.models = [{ enabled: true, id: 'jzs-max-3.0', type: 'chat' }];
    view.rerender(renderChecker());

    expect(screen.getByRole('button', { name: 'llm.checker.button' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'llm.checker.pass' })).not.toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'llm.checker.button' }));
    });

    expect(fetchPresetTaskResult).toHaveBeenLastCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ model: 'jzs-max-3.0' }),
      }),
    );
  });

  it('clears a previous probe error when the check model falls back', async () => {
    modelState.models = [
      { enabled: true, id: 'custom-model', type: 'chat' },
      { enabled: true, id: 'jzs-max-3.0', type: 'chat' },
    ];
    fetchPresetTaskResult.mockImplementation(async ({ onError, onFinish }) => {
      onError(new Error('missing'), { message: 'missing', type: 'ProviderBizError' });
      await onFinish('');
    });

    const view = render(renderChecker());

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'llm.checker.button' }));
    });

    expect(screen.getByText('render:ProviderBizError')).toBeInTheDocument();

    modelState.models = [{ enabled: true, id: 'jzs-max-3.0', type: 'chat' }];
    view.rerender(renderChecker());

    expect(screen.queryByText('render:ProviderBizError')).not.toBeInTheDocument();
  });

  it('ignores a probe that finishes after the check model falls back', async () => {
    modelState.models = [
      { enabled: true, id: 'custom-model', type: 'chat' },
      { enabled: true, id: 'jzs-max-3.0', type: 'chat' },
    ];

    let finish: ((value: string) => Promise<void> | void) | undefined;
    let release: (() => void) | undefined;
    fetchPresetTaskResult.mockImplementation(
      ({ onFinish }: { onFinish: (value: string) => Promise<void> | void }) =>
        new Promise<void>((resolve) => {
          finish = onFinish;
          release = resolve;
        }),
    );

    const view = render(renderChecker());
    const click = userEvent.click(screen.getByRole('button', { name: 'llm.checker.button' }));

    await waitFor(() => {
      expect(finish).toEqual(expect.any(Function));
    });

    modelState.models = [{ enabled: true, id: 'jzs-max-3.0', type: 'chat' }];
    view.rerender(renderChecker());

    await act(async () => {
      await finish?.('ok');
      release?.();
    });
    await click;

    expect(screen.getByRole('button', { name: 'llm.checker.button' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'llm.checker.pass' })).not.toBeInTheDocument();
  });
});
