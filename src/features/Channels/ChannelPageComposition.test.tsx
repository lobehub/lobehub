/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChannelPage from './index';

const upload = vi.hoisted(() => vi.fn());
/** The thread panel's page state is the only thing this test drives. */
const panel = vi.hoisted(() => ({ pageThreadId: null as string | null }));
/** Each case gets its own Channel: the attachment drafts live in module state, keyed by it. */
const channel = vi.hoisted(() => ({ id: 'ch-1' }));
/** The mounted Channel composer's attachments, so the test can attach a file to it. */
const composer = vi.hoisted(() => ({
  current: null as null | { items: { file: { name: string } }[]; upload: (files: File[]) => Promise<void> },
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router', () => ({ useParams: () => ({ channelId: channel.id }) }));
vi.mock('ahooks', () => ({ useSize: () => ({ width: 1200 }) }));
vi.mock('@/components/404', () => ({ default: () => null }));
vi.mock('@/components/Skeleton/RouteSegment', () => ({ RouteLoading: () => null }));
vi.mock('@/features/NavHeader', () => ({ default: () => null }));
vi.mock('@/features/EntityLink/host', () => ({
  EntityLinkHostProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: { clearPortalStack: () => void }) => unknown) =>
    selector({ clearPortalStack: () => {} }),
}));
vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    enableChannels: (state: { enableChannels: boolean }) => state.enableChannels,
  },
  useServerConfigStore: (
    selector: (state: { enableChannels: boolean; serverConfigInit: boolean }) => unknown,
  ) => selector({ enableChannels: true, serverConfigInit: true }),
}));
// Nothing is loaded, so the header and every panel fall back to their empty states.
vi.mock('@/store/channel', () => ({
  channelActions: { useFetchDetail: () => ({ error: undefined }) },
  channelSelectors: { detail: () => () => undefined },
  useChannelStore: (selector: (state: Record<string, never>) => unknown) => selector({}),
}));
vi.mock('./usePortalPanel', () => ({ usePortalPanelOpen: () => false }));
vi.mock('./useThreadPanel', () => ({
  useThreadPanel: () => ({
    close: () => {},
    draft: null,
    openDraft: () => {},
    openPage: () => {},
    openThread: () => {},
    pageThreadId: panel.pageThreadId,
    send: () => {},
    threadId: null,
  }),
}));
vi.mock('./MemberStatus', () => ({ MemberStatus: () => null }));
vi.mock('./MemberPanel', () => ({ MEMBER_FLOAT_BREAKPOINT: 800, MemberPanel: () => null }));
vi.mock('./AgentProfilePanel', () => ({ AgentProfilePanel: () => null }));
vi.mock('./ReplyTopicPanel', () => ({ ReplyTopicPanel: () => null }));
vi.mock('./PortalPanel', () => ({
  PortalPanel: () => null,
  CHANNEL_ENTITY_PORTAL_SCOPE: 'test',
}));
vi.mock('./ThreadPageTitle', () => ({ ThreadPageActions: () => null, ThreadPageTitle: () => null }));
vi.mock('./ThreadPanel', () => ({ THREAD_FLOAT_BREAKPOINT: 800, ThreadPanel: () => null }));
vi.mock('@/store/file', () => ({
  useFileStore: (selector: (state: { uploadWithProgress: typeof upload }) => unknown) =>
    selector({ uploadWithProgress: upload }),
}));
vi.mock('@lobechat/utils/compressImage', () => ({
  COMPRESSIBLE_IMAGE_TYPES: new Set<string>(),
  compressImageFile: vi.fn(),
}));
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: { error: vi.fn() },
}));

// The conversation itself is replaced by its composer: the draft lifecycle is what regressed.
vi.mock('./ChannelConversation', async () => {
  const { useAttachments } = await import('./useAttachments');
  return {
    ChannelConversation: ({
      channelId,
      threadId,
      hidden,
    }: {
      channelId: string;
      hidden?: boolean;
      threadId?: string | null;
    }) => {
      const attachments = useAttachments(`channel:${channelId}:${threadId || 'main'}`);
      composer.current = attachments;
      return (
        <div data-hidden={String(!!hidden)} data-testid={`conversation-${threadId || 'main'}`}>
          {attachments.items.map((item) => (
            <span key={item.id} data-testid="attached-file">
              {item.file.name}
            </span>
          ))}
        </div>
      );
    },
  };
});

const attachNotes = async (name = 'notes.txt') => {
  await act(async () => {
    void composer.current!.upload([new File(['x'], name, { type: 'text/plain' })]);
  });
};

/** The files the Channel's own composer is holding, whichever conversations sit beside it. */
const channelFiles = () =>
  within(screen.getByTestId('conversation-main')).getAllByTestId('attached-file');

let cases = 0;

describe('Channel page composition', () => {
  beforeEach(() => {
    cases += 1;
    // Drafts are module state keyed by Channel; a fresh key keeps one case's files out of the next.
    channel.id = `ch-${cases}`;
    panel.pageThreadId = null;
    composer.current = null;
    upload.mockReset();
    upload.mockResolvedValue({ id: 'file-1', url: 'https://cdn/notes.txt' });
  });
  afterEach(() => {
    // This suite renders the page twice; without an explicit cleanup the previous DOM would leak in.
    cleanup();
    vi.useRealTimers();
  });

  it('keeps the Channel composer mounted — and its draft — while a thread is the page', async () => {
    const { rerender } = render(<ChannelPage />);
    expect(screen.getByTestId('conversation-main').getAttribute('data-hidden')).toBe('false');
    await attachNotes();
    expect(channelFiles()).toHaveLength(1);

    // Opening a sidebar thread as the page used to swap the Channel conversation out entirely.
    panel.pageThreadId = 'thread-1';
    rerender(<ChannelPage />);

    expect(screen.getByTestId('conversation-thread-1')).toBeTruthy();
    expect(screen.getByTestId('conversation-main').getAttribute('data-hidden')).toBe('true');
    expect(channelFiles()).toHaveLength(1);

    // Closing the thread brings the Channel back with the file still attached.
    panel.pageThreadId = null;
    rerender(<ChannelPage />);
    expect(screen.getByTestId('conversation-main').getAttribute('data-hidden')).toBe('false');
    expect(channelFiles()).toHaveLength(1);
  });

  it('keeps an unfinished upload running while the Channel is covered', async () => {
    vi.useFakeTimers();
    let finish: (value: { id: string; url: string }) => void = () => {};
    upload.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    const { rerender } = render(<ChannelPage />);
    await attachNotes('report.pdf');
    const signal = upload.mock.calls.at(-1)![0].abortController.signal as AbortSignal;

    panel.pageThreadId = 'thread-1';
    rerender(<ChannelPage />);
    await act(() => vi.runAllTimersAsync());

    expect(signal.aborted).toBe(false);
    await act(async () => finish({ id: 'file-2', url: 'https://cdn/report.pdf' }));
    expect(channelFiles()).toHaveLength(1);
  });
});
