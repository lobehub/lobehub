import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FileItemHeader } from '../FileItem';

const mockRevealInFilesTab = vi.fn();

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ActionIcon: ({ icon: _icon, title, onClick, ...rest }: any) => (
      <button aria-label={title} type="button" onClick={onClick} {...rest} />
    ),
  };
});

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: any) => any) =>
    selector({ revealInFilesTab: mockRevealInFilesTab }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/components/AntdStaticMethods', () => ({
  message: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: ({ onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props} onClick={onClick} />
  ),
  confirmModal: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
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
