import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LobeAgentChatConfig } from '@/types/agent';

import type { Store } from '../store/action';
import AgentSelfIteration from './index';

const testStore = await vi.hoisted(async () => {
  const { createWithEqualityFn } = await import('zustand/traditional');
  const { shallow } = await import('zustand/shallow');

  return createWithEqualityFn<
    Pick<Store, 'disabled' | 'setChatConfig'> & {
      config: Pick<Store['config'], 'chatConfig'>;
    }
  >(() => ({ config: { chatConfig: {} }, disabled: false, setChatConfig: vi.fn() }), shallow);
});

vi.mock('@/store/agent', () => ({ useAgentStore: () => false }));
vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: { isInboxAgent: () => false },
}));

vi.mock('../store', () => ({
  selectors: {
    currentChatConfig: (state: ReturnType<typeof testStore.getState>) => state.config.chatConfig,
  },
  useStore: testStore,
}));

afterEach(cleanup);

describe('AgentSelfIteration', () => {
  it.each([false, true])(
    'saves only selfIteration when changing enabled from %s',
    async (enabled) => {
      const setChatConfig = vi.fn().mockResolvedValue(undefined);
      const chatConfig: LobeAgentChatConfig = {
        enableHistoryCount: false,
        historyCount: 5,
        selfIteration: { enabled },
      };
      testStore.setState({ config: { chatConfig }, disabled: false, setChatConfig });

      const { container } = render(<AgentSelfIteration />);

      // Another settings surface updates the config after the form took its snapshot.
      act(() => {
        testStore.setState({
          config: { chatConfig: { ...chatConfig, enableHistoryCount: true, historyCount: 20 } },
        });
      });

      fireEvent.click(screen.getByRole('switch'));
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', String(!enabled));
      fireEvent.submit(container.querySelector('form')!);

      await waitFor(() => expect(setChatConfig).toHaveBeenCalledTimes(1));
      expect(setChatConfig).toHaveBeenCalledWith({ selfIteration: { enabled: !enabled } });
    },
  );
});
