import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FileListItem } from '@/types/files';

import FileViewer from './index';

vi.mock('@/components/HtmlPreview', () => ({ isHtmlFile: () => false }));

vi.mock('./NotSupport', () => ({
  default: () => <div data-testid="unsupported-viewer" />,
}));
vi.mock('./Renderer/Code', () => ({
  default: () => <div data-testid="code-viewer" />,
}));
vi.mock('./Renderer/HTML', () => ({
  default: () => <div data-testid="html-viewer" />,
}));
vi.mock('./Renderer/Image', () => ({
  default: () => <div data-testid="image-viewer" />,
}));
vi.mock('./Renderer/MSDoc', () => ({
  default: () => <div data-testid="msdoc-viewer" />,
}));
vi.mock('./Renderer/PDF', () => ({
  default: () => <div data-testid="pdf-viewer" />,
}));
vi.mock('./Renderer/Video', () => ({
  default: () => <div data-testid="video-viewer" />,
}));

const baseItem: FileListItem = {
  chunkCount: null,
  chunkingError: null,
  createdAt: new Date(),
  embeddingError: null,
  fileType: 'custom/document',
  finishEmbedding: false,
  id: 'document-1',
  name: 'Untitled',
  size: 0,
  sourceType: 'document',
  updatedAt: new Date(),
  url: '/documents/untitled',
};

const renderViewer = (item: Partial<FileListItem>) =>
  render(<FileViewer {...baseItem} {...item} />);

describe('FileViewer routing', () => {
  it('routes a parsed generic document by the PDF extension in its URL path', () => {
    renderViewer({
      name: 'quarterly.report',
      url: 'https://storage.example.com/files/quarterly.report.PDF?signature=abc#page=2',
    });

    expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument();
  });

  it.each(['custom/document', 'CUSTOM/DOCUMENT; charset=utf-8', 'application/octet-stream'])(
    'keeps an extensionless generic %s file out of document and code viewers',
    (fileType) => {
      renderViewer({ fileType });

      expect(screen.getByTestId('unsupported-viewer')).toBeInTheDocument();
      expect(screen.queryByTestId('msdoc-viewer')).not.toBeInTheDocument();
      expect(screen.queryByTestId('code-viewer')).not.toBeInTheDocument();
    },
  );

  it('still routes a generic file with an explicit code filename to the code viewer', () => {
    renderViewer({ name: 'example.ts' });

    expect(screen.getByTestId('code-viewer')).toBeInTheDocument();
  });

  it('does not let a PDF URL path override an explicit non-generic MIME type', () => {
    renderViewer({ fileType: 'image/png', url: '/files/preview.pdf' });

    expect(screen.getByTestId('image-viewer')).toBeInTheDocument();
    expect(screen.queryByTestId('pdf-viewer')).not.toBeInTheDocument();
  });
});
