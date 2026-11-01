/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ProjectTopicList from './ProjectTopicList';

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

vi.mock('@/components/RingLoading', () => ({ default: () => <span /> }));

vi.mock('@/store/device', () => ({
  deviceSelectors: { deviceList: (s: { devices: unknown[] }) => s.devices },
  useDeviceStore: (selector: (state: object) => unknown) =>
    selector({
      devices: [
        { deviceId: 'device-1', friendlyName: 'MacBook' },
        { deviceId: 'device-2', friendlyName: 'Studio Linux' },
      ],
      useFetchDevices: () => ({}),
    }),
}));

vi.mock('@/store/projectWorkingDirectory', () => ({
  useProjectDirectories: () => [
    { deviceId: 'device-1', id: 'binding-mac' },
    { deviceId: 'device-2', id: 'binding-linux' },
  ],
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: object) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({
  preferenceSelectors: { topicSortBy: () => 'updatedAt' },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: object) => unknown) => selector({}),
}));

vi.mock('@/store/chat/selectors', () => ({
  operationSelectors: {
    unreadCompletedCountForTopics: (ids: string[]) => () =>
      ids.filter((id) => id === 'mac-done').length,
    visiblyRunningTopicIds: () => new Set(['mac-running']),
  },
}));

vi.mock('../../List/Item', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

const topics = [
  { id: 'mac-running', projectWorkingDirectoryId: 'binding-mac', title: 'Mac running' },
  {
    id: 'mac-waiting',
    projectWorkingDirectoryId: 'binding-mac',
    status: 'waitingForHuman',
    title: 'Mac waiting',
  },
  { id: 'mac-done', projectWorkingDirectoryId: 'binding-mac', title: 'Mac done' },
  { id: 'linux-idle', projectWorkingDirectoryId: 'binding-linux', title: 'Linux idle' },
] as any;

describe('ProjectTopicList device sections', () => {
  it('shows a folded device section how many of its topics run, await input or are unread', async () => {
    render(<ProjectTopicList mode={'byDevice'} topics={topics} />);

    // Expanded sections leave the status to their topic rows.
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'MacBook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Studio Linux' }));

    await waitFor(() => expect(screen.queryByText('Mac running')).toBeNull());
    expect(screen.getByRole('status', { name: 'projectStatus.loading:1' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'projectStatus.waitingForHuman:1' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'projectStatus.unread:1' })).toBeTruthy();
    // The idle Linux section has nothing to report.
    expect(screen.getAllByRole('status')).toHaveLength(3);
  });
});
