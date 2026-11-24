import { fireEvent, render, screen } from '@testing-library/react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryPane } from './MemoryPane';

// The app registers this plugin at startup.
dayjs.extend(relativeTime);

const memoryDir = '/home/me/.claude/projects/-home-me-repo/memory';

const memoryFile = (relativePath: string, type?: string, description?: string) => ({
  description,
  isIndex: relativePath === 'MEMORY.md',
  name: relativePath.replace(/\.md$/, ''),
  path: `${memoryDir}/${relativePath}`,
  relativePath,
  size: 1,
  type,
  updatedAt: Date.now(),
});

const mocks = vi.hoisted(() => ({
  current: undefined as { deviceId?: string; filePath: string } | undefined,
  data: undefined as unknown,
  openLocalFile: vi.fn(),
}));

vi.mock('./useClaudeCodeMemory', () => ({
  useClaudeCodeMemory: () => ({
    data: mocks.data,
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: vi.fn(),
  }),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({ openLocalFile: mocks.openLocalFile }),
}));
vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: {
    currentLocalFile: () => mocks.current,
    showLocalFile: () => !!mocks.current,
    showPortal: () => !!mocks.current,
  },
}));

describe('MemoryPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.current = undefined;
    mocks.data = {
      files: [
        memoryFile('MEMORY.md'),
        memoryFile('no-trailer.md', 'feedback', 'Never add a Claude co-author trailer'),
        memoryFile('plan-health.md', 'project', 'What the plan health page is for'),
      ],
      memoryDir,
    };
  });

  it('offers the index from the toolbar instead of listing it as a memory', () => {
    render(<MemoryPane workingDirectory={'/home/me/repo'} />);

    expect(screen.queryByTitle('MEMORY.md')).toBeNull();
    expect(screen.getByTitle('no-trailer.md')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'workingPanel.claudeMemory.openIndex' }));
    expect(mocks.openLocalFile).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: `${memoryDir}/MEMORY.md`, workingDirectory: memoryDir }),
    );
  });

  // The shortened text itself is covered by shortenMemoryDir; t() here returns the key.
  it('keeps the full memory directory on hover', () => {
    render(<MemoryPane workingDirectory={'/home/me/repo'} />);

    expect(screen.getByTitle(memoryDir)).toBeTruthy();
  });

  it('marks the memory the portal is showing, on the same device only', () => {
    mocks.current = { filePath: `${memoryDir}/no-trailer.md` };
    const { rerender } = render(<MemoryPane workingDirectory={'/home/me/repo'} />);

    expect(screen.getByTitle('no-trailer.md').getAttribute('aria-current')).toBe('true');
    expect(screen.getByTitle('plan-health.md').getAttribute('aria-current')).toBeNull();

    rerender(<MemoryPane deviceId={'device-1'} workingDirectory={'/home/me/repo'} />);
    expect(screen.getByTitle('no-trailer.md').getAttribute('aria-current')).toBeNull();
  });
});
