import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as storeModule from '../../../store';
import Render from './Render';

const mocks = vi.hoisted(() => ({
  openFilePreview: vi.fn(),
  useFetchKnowledgeItem: vi.fn(() => ({ data: undefined })),
}));

vi.mock('../../../store', async (importOriginal) => {
  const original = await importOriginal<typeof storeModule>();
  return { ...original, useConversationStore: vi.fn() };
});

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({ openFilePreview: mocks.openFilePreview }),
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (s: unknown) => unknown) =>
    selector({ useFetchKnowledgeItem: mocks.useFetchKnowledgeItem }),
}));

const mockUseConversationStore = vi.mocked(storeModule.useConversationStore);

const withContext = (context: Record<string, string>) =>
  mockUseConversationStore.mockImplementation(((selector: (s: unknown) => unknown) =>
    selector({ context })) as never);

const renderLink = () =>
  render(
    <Render
      {...({
        node: {
          properties: {
            fileId: 'file_1',
            linkHref: 'https://lobehub.com/resource/file/file_1',
            linkLabel: 'intro.mp4',
            proxyHref: 'https://lobehub.com/f/file_1',
          },
        },
      } as any)}
    />,
  );

describe('FileLink Render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the owner-scoped preview by id in the owner conversation', () => {
    withContext({ agentId: 'agt_1' });
    renderLink();

    fireEvent.click(screen.getByText('intro.mp4'));

    expect(mocks.openFilePreview).toHaveBeenCalledWith({ fileId: 'file_1' });
  });

  // Regression: a topic-share reader got the owner-scoped preview, which reads
  // the visitor's empty file store and showed the file as unavailable.
  it('previews from the public proxy for a topic-share reader', () => {
    withContext({ agentId: 'agt_1', topicShareId: 'share_1' });
    renderLink();

    fireEvent.click(screen.getByText('intro.mp4'));

    expect(mocks.openFilePreview).toHaveBeenCalledWith({
      fileId: 'file_1',
      source: { name: 'intro.mp4', url: 'https://lobehub.com/f/file_1' },
    });
  });
});
