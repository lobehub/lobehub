import { describe, expect, it } from 'vitest';

import { compactDirectoryTail, compactFileName, getFileExtension } from './localFileDisplay';

describe('localFileDisplay', () => {
  it('should preserve filename extension when compacting long names', () => {
    const result = compactFileName(
      'very-long-generated-component-name-for-settings-panel.test.tsx',
    );

    expect(result).toContain('...');
    expect(result.endsWith('test.tsx')).toBe(true);
  });

  it('should display the distinguishing directory tail instead of the shared path prefix', () => {
    expect(
      compactDirectoryTail(
        'src/features/ChatInput/InputEditor/MentionMenu/MenuItem.tsx',
        'MenuItem.tsx',
      ),
    ).toBe('.../ChatInput/InputEditor/MentionMenu/');
  });

  it('should detect file extensions', () => {
    expect(getFileExtension('index.tsx')).toBe('tsx');
    expect(getFileExtension('.gitignore')).toBe('');
  });
});
