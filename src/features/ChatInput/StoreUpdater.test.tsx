import { type MenuProps } from '@lobehub/ui';
import { render } from '@testing-library/react';
import { type PropsWithChildren, useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useSingleton } from '@/hooks/useSingleton';

import { createStore, Provider, useChatInputStore } from './store';
import StoreUpdater from './StoreUpdater';

interface TestHarnessProps {
  onSendMenuChange: (menu: MenuProps | undefined) => void;
  sendMenu?: MenuProps;
}

const Probe = ({
  onSendMenuChange,
}: {
  onSendMenuChange: TestHarnessProps['onSendMenuChange'];
}) => {
  const sendMenu = useChatInputStore((s) => s.sendMenu);

  useEffect(() => {
    onSendMenuChange(sendMenu);
  }, [onSendMenuChange, sendMenu]);

  return null;
};

const TestHarness = ({ children }: PropsWithChildren) => {
  const store = useSingleton(createStore);

  return <Provider createStore={() => store}>{children}</Provider>;
};

describe('ChatInput StoreUpdater', () => {
  it('clears sendMenu when the prop becomes undefined', () => {
    const initialSendMenu = { items: [{ key: 'test', label: 'Test' }] } satisfies MenuProps;
    const onSendMenuChange = vi.fn();

    const { rerender } = render(
      <TestHarness>
        <StoreUpdater
          leftActions={[]}
          rightActions={[]}
          sendMenu={initialSendMenu}
          onSend={() => {}}
        />
        <Probe onSendMenuChange={onSendMenuChange} />
      </TestHarness>,
    );

    expect(onSendMenuChange).toHaveBeenLastCalledWith(initialSendMenu);

    rerender(
      <TestHarness>
        <StoreUpdater leftActions={[]} rightActions={[]} sendMenu={undefined} onSend={() => {}} />
        <Probe onSendMenuChange={onSendMenuChange} />
      </TestHarness>,
    );

    expect(onSendMenuChange).toHaveBeenLastCalledWith(undefined);
  });
});
