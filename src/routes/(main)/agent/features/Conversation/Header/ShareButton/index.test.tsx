/**
 * @vitest-environment happy-dom
 */
import type * as BaseUI from '@lobehub/ui/base-ui';
import { render } from '@testing-library/react';
import type { ComponentProps, ComponentType, ReactNode } from 'react';
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

const actionIconPropsSpy = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof BaseUI>();
  return {
    ...actual,
    ActionIcon: (props: ComponentProps<typeof actual.ActionIcon>) => {
      actionIconPropsSpy(props);
      return <actual.ActionIcon {...props} />;
    },
  };
});

vi.mock('next/dynamic', () => ({
  default: () =>
    function DynamicComponent({ children }: { children?: ReactNode }) {
      return <div data-testid="share-popover">{children}</div>;
    },
}));

vi.mock('@/components/withSuspense', () => ({
  withSuspense: (Component: ComponentType) => Component,
}));

vi.mock('@/features/ShareModal', () => ({
  useShareModal: () => ({
    openShareModal: vi.fn(),
  }),
}));

vi.mock('@/features/Conversation/useAgentContext', () => ({
  useAgentContext: () => ({ topicId: mocks.activeTopicId }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.permission.allowed, reason: mocks.permission.reason }),
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

describe('Conversation ShareButton', () => {
  beforeEach(() => {
    mocks.activeTopicId = 'topic-1';
    mocks.enableBusinessFeatures = true;
    mocks.permission.allowed = true;
    actionIconPropsSpy.mockClear();
  });

  it('does not open share popover for workspace viewers', () => {
    mocks.permission.allowed = false;

    const { queryByTestId } = render(<ShareButton />);

    expect(actionIconPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        disabled: true,
        onClick: undefined,
        title: 'requires member',
      }),
    );
    expect(queryByTestId('share-popover')).toBeNull();
  });
});
