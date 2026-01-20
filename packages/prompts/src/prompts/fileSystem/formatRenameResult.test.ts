import { describe, expect, it } from 'vitest';

import { formatRenameResult } from './formatRenameResult';

describe('formatRenameResult', () => {
  it('should format successful rename', () => {
    const result = formatRenameResult({
      newName: 'newFile.ts',
      oldPath: '/src/oldFile.ts',
      success: true,
    });
    expect(result).toMatchInlineSnapshot(
      `"Successfully renamed file /src/oldFile.ts to newFile.ts"`,
    );
  });

  it('should format failed rename', () => {
    const result = formatRenameResult({
      error: 'File already exists',
      newName: 'existing.ts',
      oldPath: '/src/file.ts',
      success: false,
    });
    expect(result).toMatchInlineSnapshot(`"Failed to rename file: File already exists"`);
  });

  it('should format failed rename without error message', () => {
    const result = formatRenameResult({
      newName: 'newName.ts',
      oldPath: '/src/file.ts',
      success: false,
    });
    expect(result).toMatchInlineSnapshot(`"Failed to rename file: undefined"`);
  });
});
