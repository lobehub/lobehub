/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes, HTMLAttributes, PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BatchImportContent } from './BatchImportModal';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  createFile: vi.fn(async () => ({ id: 'file-1' })),
  importBatch: vi.fn(async () => ({
    results: [{ name: 'skill-a', path: 'skill-a', status: 'created' as const }],
    summary: { created: 1, failed: 0, skipped: 0, unchanged: 0, updated: 0 },
  })),
  previewBatch: vi.fn(async () => ({
    candidates: [{ description: 'A skill', name: 'skill-a', path: 'skill-a' }],
  })),
  removeUnreferencedFile: vi.fn(async () => undefined),
  releaseUpload: vi.fn(async () => undefined),
  setCanDismissByClickOutside: vi.fn(),
  uploadFileToS3: vi.fn(async () => ({ data: { path: '/skills/archive.zip' } })),
}));

vi.mock('@lobehub/ui', async () => {
  const React = await import('react');

  const passthrough = ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) =>
    React.createElement('div', props as HTMLAttributes<HTMLDivElement>, children);

  return {
    Alert: passthrough,
    Block: passthrough,
    Button: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) =>
      React.createElement('button', props as ButtonHTMLAttributes<HTMLButtonElement>, children),
    Checkbox: () => React.createElement('input', { type: 'checkbox' }),
    Flexbox: passthrough,
    Icon: () => null,
    ScrollArea: passthrough,
    Segmented: passthrough,
    Spin: () => null,
    Tag: passthrough,
    Text: passthrough,
    Upload: ({ children, onFiles, dragger }: PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(
        'div',
        {
          'data-dragger': String(dragger),
          'data-testid': 'batch-upload',
          onClick: () =>
            (onFiles as (files: File[]) => void)([
              {
                arrayBuffer: async () => new ArrayBuffer(0),
                name: 'archive.zip',
                size: 7,
                type: 'application/zip',
              } as File,
            ]),
        } as HTMLAttributes<HTMLDivElement>,
        children,
      ),
    createModal: vi.fn(),
    toast: { success: vi.fn() },
    useModalContext: () => ({
      close: mocks.close,
      setCanDismissByClickOutside: mocks.setCanDismissByClickOutside,
    }),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('js-sha256', () => ({
  sha256: vi.fn(() => 'archive-hash'),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/libs/trpc/client/lambda', () => ({
  lambdaClient: { file: { createFile: { mutate: mocks.createFile } } },
}));

vi.mock('@/services/file', () => ({
  fileService: { removeUnreferencedFile: mocks.removeUnreferencedFile },
}));

vi.mock('@/services/upload', () => ({
  uploadService: {
    releaseUpload: mocks.releaseUpload,
    uploadFileToS3: mocks.uploadFileToS3,
  },
}));

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      importAgentSkillsFromZipBatch: mocks.importBatch,
      previewAgentSkillBatchImport: mocks.previewBatch,
    }),
}));

describe('BatchImportContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enables drag and drop and keeps the result action sticky while results scroll', async () => {
    render(<BatchImportContent />);

    expect(screen.getByTestId('batch-upload')).toHaveAttribute('data-dragger', 'true');

    fireEvent.click(screen.getByTestId('batch-upload'));
    await waitFor(() =>
      expect(screen.getByText('agentSkillModal.batch.import')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText('agentSkillModal.batch.import'));
    await waitFor(() =>
      expect(screen.getByText('agentSkillModal.batch.result.done')).toBeInTheDocument(),
    );

    expect(screen.getByText('agentSkillModal.batch.result.done').parentElement).toHaveStyle({
      bottom: '0px',
      position: 'sticky',
    });
  });
});
