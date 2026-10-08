/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FileListItem } from '@/types/files';

import FileViewer from './index';
import { useImageStage } from './Renderer/Image/context';

const baseFile: FileListItem = {
  chunkCount: null,
  chunkingError: null,
  createdAt: new Date(),
  embeddingError: null,
  fileType: 'image/png',
  finishEmbedding: false,
  id: 'file_img',
  name: 'sunset.png',
  size: 10,
  sourceType: 'file',
  updatedAt: new Date(),
  url: 'https://s3/sunset.png',
};

const Tools = () => <div data-file-id={useImageStage().fileId} data-testid={'tools'} />;

const loadImage = () => {
  const img = document.querySelector('img')!;
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 400 });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 300 });
  fireEvent.load(img);
};

describe('FileViewer image entry', () => {
  it('routes images to the image viewer with the host tools and close action', () => {
    const onClose = vi.fn();
    render(<FileViewer {...baseFile} imageTools={<Tools />} onClose={onClose} />);
    loadImage();

    expect(screen.getByTestId('image-viewer')).toHaveAttribute('aria-label', 'sunset.png');
    expect(screen.getByTestId('tools')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.close' }));
    expect(onClose).toHaveBeenCalled();
  });

  // Regression: a document-coalesced item's `id` is `docs_*`; the tools must
  // work on the persisted `file_*` behind it.
  it('gives the tools the backing file id of a document item', () => {
    render(
      <FileViewer {...baseFile} fileId={'file_backing'} id={'docs_item'} imageTools={<Tools />} />,
    );
    loadImage();

    expect(screen.getByTestId('tools')).toHaveAttribute('data-file-id', 'file_backing');
  });

  // Regression: the `/f/:id` proxy redirects to storage without CORS, so a
  // blob download would only open the inline preview.
  it('downloads a proxied file through the attachment route', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<FileViewer {...baseFile} url={'https://app.lobehub.com/f/file_img'} />);
    loadImage();

    fireEvent.click(screen.getByRole('button', { name: 'imageViewer.download' }));

    expect(open).toHaveBeenCalledWith(
      'https://app.lobehub.com/f/file_img?download=1',
      '_blank',
      'noopener,noreferrer',
    );
    open.mockRestore();
  });

  it('keeps read-only hosts (no tools) free of editing UI', () => {
    render(<FileViewer {...baseFile} />);
    loadImage();

    expect(screen.getByTestId('image-viewer')).toBeInTheDocument();
    expect(screen.queryByTestId('tools')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'imageViewer.download' })).toBeInTheDocument();
  });

  it('matches images by extension when the MIME type is generic', () => {
    render(<FileViewer {...baseFile} fileType={'application/octet-stream'} name={'photo.webp'} />);
    expect(screen.getByTestId('image-viewer')).toBeInTheDocument();
  });

  it('does not render image tools for non-image files', () => {
    render(
      <FileViewer
        {...baseFile}
        fileType={'video/mp4'}
        imageTools={<Tools />}
        name={'clip.mp4'}
        url={'https://s3/clip.mp4'}
      />,
    );

    expect(screen.queryByTestId('image-viewer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tools')).not.toBeInTheDocument();
  });
});
