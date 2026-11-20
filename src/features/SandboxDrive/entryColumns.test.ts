import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { describe, expect, it } from 'vitest';

import { formatSize } from '@/utils/format';

import { entryKind, entryModified, entrySize, sortDriveEntries } from './entryColumns';

// Loaded app-wide in the product.
dayjs.extend(relativeTime);

const t = (key: string, options?: Record<string, unknown>) =>
  options?.extension ? `${key}:${options.extension}` : key;

describe('entryColumns', () => {
  it('lists folders first, then by name', () => {
    const sorted = sortDriveEntries([
      { isDirectory: false, name: 'b.txt' },
      { isDirectory: true, name: 'notes' },
      { isDirectory: false, name: 'a.txt' },
      { isDirectory: true, name: 'app' },
    ]);

    expect(sorted.map((entry) => entry.name)).toEqual(['app', 'notes', 'a.txt', 'b.txt']);
  });

  it('says what each entry is: git repository, folder, or file by its extension', () => {
    expect(entryKind({ isDirectory: true, isGitRepository: true, name: 'app' }, t)).toBe(
      'drive.explorer.kind.gitRepository',
    );
    expect(entryKind({ isDirectory: true, name: 'notes' }, t)).toBe('drive.explorer.kind.folder');
    expect(entryKind({ isDirectory: false, name: 'report.pdf' }, t)).toBe(
      'drive.explorer.kind.fileWithExtension:PDF',
    );
    expect(entryKind({ isDirectory: false, name: 'Makefile' }, t)).toBe('drive.explorer.kind.file');
    expect(entryKind({ isDirectory: false, name: '.env' }, t)).toBe('drive.explorer.kind.file');
  });

  it('gives a folder no size, and a file under a kilobyte its size in bytes, not "0.0 KB"', () => {
    expect(entrySize({ isDirectory: true, name: 'notes' })).toBe('--');
    expect(entrySize({ isDirectory: false, name: 'a.md', size: 17 })).toBe('17 B');
    expect(entrySize({ isDirectory: false, name: 'r.pdf', size: 2048 })).toBe(formatSize(2048));
  });

  it('shows the modified time absolute, even for a file changed just now', () => {
    const shown = entryModified({
      isDirectory: false,
      modifiedAt: new Date().toISOString(),
      name: 'a.md',
    });

    // Relative wording ("a few seconds ago") wrapped in the fixed column.
    expect(shown).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
