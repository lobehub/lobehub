/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ShareButton from './index';

const mocks = vi.hoisted(() => ({
  activeTopicId: 'topic-1' as string | undefined,
  enableBusinessFeatures: true,
  permission: {
    allowed: true,
    reason: 'requires member',
  },
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    disabled,
    onClick,
    title,
  }: {
    disabled?: boolean;
    onClick?: () => void;
    title?: string;
  }) => (
    <button data-testid="share-button" disabled={disabled} title={title} onClick={onClick}>
      {title}
    </button>
  ),
}));

vi.mock('@/libs/next/dynamic', () => ({
  default: () =>
    function DynamicComponent({ children }: { children?: ReactNode }) {
      return <div data-testid="share-popover">{children}</div>;
    },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/features/ShareModal', () => ({
  useShareModal: () => ({
    openShareModal: vi.fn(),
  }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.permission.allowed, reason: mocks.permission.reason }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: { activeTopicId?: string }) => unknown) =>
    selector({ activeTopicId: mocks.activeTopicId }),
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (
    selector: (state: { serverConfig: { enableBusinessFeatures: boolean } }) => unknown,
  ) => selector({ serverConfig: { enableBusinessFeatures: mocks.enableBusinessFeatures } }),
}));

vi.mock('@/store/serverConfig/selectors', () => ({
  serverConfigSelectors: {
    enableBusinessFeatures: (s: { serverConfig: { enableBusinessFeatures: boolean } }) =>
      s.serverConfig.enableBusinessFeatures,
  },
}));

describe('Group Conversation ShareButton', () => {
  beforeEach(() => {
    mocks.activeTopicId = 'topic-1';
    mocks.enableBusinessFeatures = true;
    mocks.permission.allowed = true;
  });

  it('does not open share popover for workspace viewers', () => {
    mocks.permission.allowed = false;

    const { queryByTestId, getByTestId } = render(<ShareButton />);

    expect(getByTestId('share-button')).toBeDisabled();
    expect(getByTestId('share-button')).toHaveAttribute('title', 'requires member');
    expect(queryByTestId('share-popover')).toBeNull();
  });
});
