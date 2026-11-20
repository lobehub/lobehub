import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Render from './Render';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(async () => {}),
  openFilePreview: vi.fn(),
  openTrustedExternalUrl: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  copyToClipboard: mocks.copyToClipboard,
  toast: { success: vi.fn() },
}));

vi.mock('@/utils/openTrustedExternalUrl', () => ({
  openTrustedExternalUrl: mocks.openTrustedExternalUrl,
}));

vi.mock('../../../hooks/useOpenConversationFilePreview', () => ({
  useOpenConversationFilePreview: () => mocks.openFilePreview,
}));

vi.mock('../../../store', () => ({
  useConversationStore: (selector: (s: unknown) => unknown) =>
    selector({ context: { agentId: 'agt_1', topicId: 'tpc_1' } }),
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (s: unknown) => unknown) =>
    selector({ useFetchKnowledgeItem: () => ({ data: { name: 'after-compact.png' } }) }),
}));

const renderLink = () =>
  render(
    <Render
      node={{
        properties: {
          fileId: 'file_1',
          linkHref: '/resource/file/file_1',
          linkLabel: 'after-compact.png',
          linkScope: 'active',
        },
      }}
    />,
  );

describe('FileLink Render', () => {
  beforeEach(() => {
    mocks.copyToClipboard.mockClear();
    mocks.openFilePreview.mockClear();
    mocks.openTrustedExternalUrl.mockClear();
  });

  it('opens the file address in the browser from the action beside the link', () => {
    const view = renderLink();

    fireEvent.click(view.getByTitle('report.actions.openInBrowser'));

    expect(mocks.openTrustedExternalUrl).toHaveBeenCalledWith(
      `${window.location.origin}/resource/file/file_1`,
    );
    expect(mocks.openFilePreview).not.toHaveBeenCalled();
  });

  it('keeps the copy action copying the same address', async () => {
    const view = renderLink();

    fireEvent.click(view.getByTitle('copy'));

    await vi.waitFor(() =>
      expect(mocks.copyToClipboard).toHaveBeenCalledWith(
        `${window.location.origin}/resource/file/file_1`,
      ),
    );
  });
});
