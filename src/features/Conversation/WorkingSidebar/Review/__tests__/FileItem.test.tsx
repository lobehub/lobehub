import { confirmModal } from '@lobehub/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import FileItemBody, { FileItemHeader } from '../FileItem';

const mockRevealInFilesTab = vi.fn();

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: any) => any) =>
    selector({ revealInFilesTab: mockRevealInFilesTab }),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ActionIcon: ({ onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props} onClick={onClick} />
  ),
  confirmModal: vi.fn(),
  Skeleton: { Text: () => <div data-testid="skeleton-text" /> },
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/file', () => ({
  useFileStore: (selector: (s: any) => any) => selector({ addChatContextSelection: vi.fn() }),
}));

vi.mock('@/services/git', () => ({
  gitService: { revertGitFile: vi.fn() },
}));

describe('FileItemHeader — reveal in tree', () => {
  it('renders the reveal button', () => {
    render(<FileItemHeader additions={1} deletions={0} filePath="src/foo.ts" status="modified" />);

    const btn = screen.getByTestId('reveal-in-tree');
    expect(btn).toBeTruthy();
  });

  it('calls revealInFilesTab with the file path on click', () => {
    render(<FileItemHeader additions={1} deletions={0} filePath="src/foo.ts" status="modified" />);

    const btn = screen.getByTestId('reveal-in-tree');
    fireEvent.click(btn);

    expect(mockRevealInFilesTab).toHaveBeenCalledWith('src/foo.ts');
  });

  it('stops event propagation so parent onClick is not triggered', () => {
    const parentSpy = vi.fn();

    render(
      <div onClick={parentSpy}>
        <FileItemHeader additions={1} deletions={0} filePath="src/foo.ts" status="modified" />
      </div>,
    );

    const btn = screen.getByTestId('reveal-in-tree');
    fireEvent.click(btn);

    expect(parentSpy).not.toHaveBeenCalled();
  });
});

describe('FileItemHeader — revert', () => {
  const revertContext = { deviceId: 'device-1', workingDirectory: '/repo' };

  it('asks for confirmation before reverting a live row', () => {
    vi.mocked(confirmModal).mockClear();
    render(
      <FileItemHeader
        additions={1}
        deletions={0}
        filePath="src/foo.ts"
        revertContext={revertContext}
        status="modified"
      />,
    );

    fireEvent.click(screen.getByTestId('revert-file'));

    expect(confirmModal).toHaveBeenCalledTimes(1);
  });

  // Regression: a row painted from the persisted summary kept revert enabled,
  // so it could discard content at that path the summary never showed.
  it('keeps revert inert while the row is an unconfirmed summary', () => {
    vi.mocked(confirmModal).mockClear();
    render(
      <FileItemHeader
        revertDisabled
        additions={1}
        deletions={0}
        filePath="src/foo.ts"
        revertContext={revertContext}
        status="modified"
      />,
    );

    const button = screen.getByTestId('revert-file');
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(confirmModal).not.toHaveBeenCalled();
  });
});

describe('FileItemBody — summary rows', () => {
  const props = {
    composerTarget: { contextKey: 'ctx', writable: true } as any,
    expanded: true,
    filePath: 'src/foo.ts',
    isBinary: false,
    patch: '',
    textDiff: true,
    truncated: false,
    viewMode: 'unified' as const,
    wordWrap: false,
    workingDirectory: '/repo',
  };

  // Regression: a row painted from the persisted summary has no diff text yet;
  // without the pending state it read as a load error until the live diff landed.
  it('shows a placeholder, not the error line, while the diff text is pending', () => {
    render(<FileItemBody {...props} pending />);

    expect(screen.getByTestId('review-diff-pending')).toBeInTheDocument();
    expect(screen.queryByText('workingPanel.review.error')).not.toBeInTheDocument();
  });

  it('still reports a missing diff once the live read settled', () => {
    render(<FileItemBody {...props} />);

    expect(screen.getByText('workingPanel.review.error')).toBeInTheDocument();
  });
});
