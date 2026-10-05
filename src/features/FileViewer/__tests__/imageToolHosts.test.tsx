/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { FileListItem } from '@/types/files';

/** Records what each host hands to the shared viewer. */
const viewerProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@/features/FileViewer', () => ({
  default: (props: { imageTools?: ReactNode } & Record<string, unknown>) => {
    viewerProps.push(props);
    return <div data-testid={'file-viewer'}>{props.imageTools}</div>;
  },
}));
vi.mock('@/features/FileViewer/ImageEditTools', () => ({
  default: () => <div data-testid={'image-edit-tools'} />,
}));

const file: FileListItem = {
  chunkCount: null,
  chunkingError: null,
  createdAt: new Date(),
  embeddingError: null,
  fileId: 'file_img',
  fileType: 'image/png',
  finishEmbedding: false,
  id: 'docs_img',
  name: 'sunset.png',
  size: 10,
  sourceType: 'file',
  updatedAt: new Date(),
  url: 'https://s3/sunset.png',
};

vi.mock('@/store/file', () => ({
  fileManagerSelectors: { getFileById: () => () => file },
  useFileStore: (selector: (s: unknown) => unknown) =>
    selector({ useFetchKnowledgeItem: () => ({ data: file }) }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({ activeTopicId: 'tpc_1', chunkText: undefined, previewFileId: 'file_img' }),
}));
vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: {
    chunkText: (s: { chunkText?: string }) => s.chunkText,
    previewFileId: (s: { previewFileId?: string }) => s.previewFileId,
  },
}));

describe('image tool hosts', () => {
  it('resource detail panel mounts the editing tools on the real file id', async () => {
    const { default: FilePreview } =
      await import('@/features/ResourceManager/components/Explorer/FileDetailPanel/FilePreview');
    viewerProps.length = 0;
    render(<FilePreview file={file} />);

    expect(screen.getByTestId('image-edit-tools')).toBeInTheDocument();
    expect(viewerProps.at(-1)).toMatchObject({ id: 'file_img' });
  });

  it('full-screen resource editor mounts the tools and forwards close', async () => {
    const { default: FileContent } =
      await import('@/features/ResourceManager/components/Editor/FileContent');
    const onClose = vi.fn();
    viewerProps.length = 0;
    render(<FileContent fileId={'file_img'} onClose={onClose} />);

    expect(screen.getByTestId('image-edit-tools')).toBeInTheDocument();
    expect(viewerProps.at(-1)).toMatchObject({ onClose });
  });

  it('conversation portal file preview mounts the tools', async () => {
    const { default: PortalFilePreview } = await import('@/features/Portal/FilePreview/Body');
    viewerProps.length = 0;
    render(<PortalFilePreview />);

    expect(screen.getByTestId('image-edit-tools')).toBeInTheDocument();
    expect(viewerProps.at(-1)).toMatchObject({ id: 'docs_img', name: 'sunset.png' });
  });
});
