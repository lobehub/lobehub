import { describe, expect, it } from 'vitest';

import { formatWriteResult } from './formatWriteResult';

describe('formatWriteResult', () => {
  it('should format successful write', () => {
    const result = formatWriteResult({
      path: '/src/newFile.ts',
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`"Successfully wrote to /src/newFile.ts"`);
  });

  it('should format failed write with error', () => {
    const result = formatWriteResult({
      error: 'Permission denied',
      path: '/protected/file.ts',
      success: false,
    });
    expect(result).toMatchInlineSnapshot(`"Failed to write file: Permission denied"`);
  });

  it('should format failed write without error message', () => {
    const result = formatWriteResult({
      path: '/some/path.ts',
      success: false,
    });
    expect(result).toMatchInlineSnapshot(`"Failed to write file: Unknown error"`);
  });
});
