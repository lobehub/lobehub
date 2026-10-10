/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDiscoverStore } from '@/store/discover';
import { pluginDetailQueryKey } from '@/store/discover/slices/plugin/projection';
import { globalHelpers } from '@/store/global/helpers';

import PluginItem from './PluginItem';

// The marketplace read is the only thing faked: the store slice, its replica
// and the component are the real ones. `getPluginDetail` rejects outright so a
// rendered title can only come from the replica view, not the network.
vi.mock('@/services/discover', () => ({
  discoverService: {
    getPluginCategories: vi.fn(),
    getPluginDetail: vi.fn(() => Promise.reject(new Error('offline'))),
    getPluginIdentifiers: vi.fn(),
    getPluginList: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({}),
  cssVar: new Proxy({}, { get: () => 'var(--x)' }),
  cx: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@lobechat/builtin-tools', () => ({ builtinTools: [] }));

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: () => null,
  Image: () => null,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Avatar: () => null,
  Skeleton: { Text: () => <div data-testid="skeleton" /> },
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

const IDENTIFIER = 'weather-plugin';

const seedDetail = () =>
  useDiscoverStore.setState({
    pluginDetailMap: {
      [pluginDetailQueryKey({ identifier: IDENTIFIER, locale: 'en-US', withManifest: false })]: {
        author: 'LobeHub',
        avatar: '',
        createdAt: '',
        description: 'Weather lookups for the agent',
        homepage: 'https://lobehub.com',
        identifier: IDENTIFIER,
        manifest: undefined,
        related: [],
        schemaVersion: 1,
        source: 'builtin',
        tags: ['weather'],
        title: 'Weather Plugin',
      } as any,
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');
  useDiscoverStore.setState({ pluginDetailMap: {} });
});

describe('PluginItem (replica-backed plugin detail)', () => {
  it('paints the plugin title from the replica even though the network fetch fails', async () => {
    seedDetail();

    render(<PluginItem identifier={IDENTIFIER} />);

    // The title can only come from the seeded replica view: the only faked
    // dependency (getPluginDetail) rejects, so the network path yields nothing.
    expect(await screen.findByText('Weather Plugin')).toBeTruthy();
    expect(screen.queryByTestId('skeleton')).toBeNull();
    expect(screen.getByText('Weather lookups for the agent')).toBeTruthy();
  });

  it('shows the loading skeleton while the entry is still empty', () => {
    render(<PluginItem identifier={IDENTIFIER} />);

    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });
});
