import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DriveFilePreviewContent } from './DriveFilePreview';

const service = vi.hoisted(() => ({ preparePreview: vi.fn() }));
const viewer = vi.hoisted(() => ({ props: vi.fn() }));

vi.mock('@/services/sandboxStorage', () => ({ sandboxStorageService: service }));
vi.mock('@/features/FileViewer', () => ({
  default: (props: Record<string, unknown>) => {
    viewer.props(props);
    return <div data-testid={'file-viewer'}>{String(props.url)}</div>;
  },
}));

const entry = { name: 'report.pdf', path: 'docs/report.pdf' };

describe('DriveFilePreviewContent', () => {
  beforeEach(() => {
    service.preparePreview.mockReset();
    viewer.props.mockReset();
  });

  it('copies the file out of the drive, then shows it in the resource library viewer', async () => {
    service.preparePreview.mockResolvedValue({
      contentType: 'application/pdf',
      fileName: 'report.pdf',
      kind: 'file',
      size: 9,
      url: 'https://cdn/copy?inline',
    });

    render(<DriveFilePreviewContent drive={'personal'} entry={entry} />);

    expect(screen.getByText('drive.explorer.previewPreparing')).toBeInTheDocument();
    expect(await screen.findByTestId('file-viewer')).toHaveTextContent('https://cdn/copy?inline');
    expect(service.preparePreview).toHaveBeenCalledWith({
      drive: 'personal',
      path: 'docs/report.pdf',
    });
    expect(viewer.props).toHaveBeenLastCalledWith(
      expect.objectContaining({ fileType: 'application/pdf', name: 'report.pdf', size: 9 }),
    );
  });

  it('says the preview failed and copies again on retry', async () => {
    service.preparePreview.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      contentType: 'text/plain',
      fileName: 'report.pdf',
      kind: 'file',
      size: 1,
      url: 'https://cdn/second',
    });

    render(<DriveFilePreviewContent drive={'public'} entry={entry} />);

    fireEvent.click(await screen.findByText('retry'));
    expect(await screen.findByTestId('file-viewer')).toHaveTextContent('https://cdn/second');
    expect(service.preparePreview).toHaveBeenCalledTimes(2);
  });
});
