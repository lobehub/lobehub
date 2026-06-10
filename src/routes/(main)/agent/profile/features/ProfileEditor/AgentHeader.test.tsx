/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AgentHeader from './AgentHeader';

const emojiPickerProps = vi.hoisted(() => ({
  last: undefined as any,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: any) => <div>{children}</div>,
  Icon: () => <span />,
  Input: () => <input readOnly />,
  Skeleton: {
    Button: () => <div />,
  },
  Tooltip: ({ children }: any) => <>{children}</>,
}));

vi.mock('ahooks', () => ({
  useDebounceFn: (fn: (...args: unknown[]) => void) => ({ run: fn }),
}));

vi.mock('antd', () => ({
  message: { error: vi.fn() },
}));

vi.mock('@/components/EmojiPicker', () => ({
  default: vi.fn((props: any) => {
    emojiPickerProps.last = props;
    return <button type="button">avatar</button>;
  }),
}));

vi.mock('@/features/AgentSetting/AgentMeta/BackgroundSwatches', () => ({
  default: () => <div />,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: false, reason: 'requires member' }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: any) =>
    selector({
      meta: {
        avatar: '🍷',
        backgroundColor: undefined,
        title: 'Readonly agent',
      },
      updateAgentMeta: vi.fn(),
    }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentMeta: (s: any) => s.meta,
  },
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: any) => selector({ uploadWithProgress: vi.fn() }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: any) => selector({ language: 'en-US' }),
}));

vi.mock('@/store/global/selectors', () => ({
  globalGeneralSelectors: {
    currentLanguage: (s: any) => s.language,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('AgentHeader', () => {
  beforeEach(() => {
    emojiPickerProps.last = undefined;
  });

  it('keeps the emoji picker closed when edits are not allowed', () => {
    render(<AgentHeader />);

    expect(emojiPickerProps.last?.open).toBe(false);
  });
});
