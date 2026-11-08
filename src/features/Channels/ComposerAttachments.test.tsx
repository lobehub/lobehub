/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ComposerAttachments } from './ComposerAttachments';
import type { DraftFile } from './useAttachments';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));
vi.mock(
  '@/features/ChatInput/Desktop/ContextContainer/ContextItem/FilePreviewModal.loader',
  () => ({
    openFilePreviewModal: vi.fn(),
  }),
);
vi.mock('@/business/client/features/FileUploadErrorActions', () => ({
  FileUploadErrorActions: () => null,
}));

const draft = (name: string, type: string, patch: Partial<DraftFile> = {}): DraftFile =>
  ({ file: new File(['x'], name, { type }), id: name, status: 'success', ...patch }) as DraftFile;

describe('ComposerAttachments', () => {
  it('shows an image from its local copy while it uploads', () => {
    render(
      <ComposerAttachments
        items={[
          draft('shot.png', 'image/png', {
            previewUrl: 'blob:local',
            status: 'uploading',
            uploadState: { progress: 40, restTime: 1, speed: 1 },
          }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByAltText('shot.png').getAttribute('src')).toBe('blob:local');
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('attachments.uploading');
  });

  it('removes from the corner and retries a failed upload', () => {
    const onRemove = vi.fn();
    const onRetry = vi.fn();
    render(
      <ComposerAttachments
        items={[draft('notes.pdf', 'application/pdf', { status: 'error' })]}
        onRemove={onRemove}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByText('attachments.retry'));
    fireEvent.click(screen.getByRole('button', { name: 'attachments.remove:notes.pdf' }));
    expect(onRetry).toHaveBeenCalledWith('notes.pdf');
    expect(onRemove).toHaveBeenCalledWith('notes.pdf');
    expect(screen.getByText('attachments.failedShort')).toBeTruthy();
  });

  it('renders nothing without attachments', () => {
    const { container } = render(
      <ComposerAttachments items={[]} onRemove={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
