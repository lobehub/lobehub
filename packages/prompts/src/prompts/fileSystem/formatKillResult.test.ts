import { describe, expect, it } from 'vitest';

import { formatKillResult } from './formatKillResult';

describe('formatKillResult', () => {
  it('should format successful kill', () => {
    const result = formatKillResult({
      shellId: 'shell-123',
      success: true,
    });
    expect(result).toMatchInlineSnapshot(`"Successfully killed shell: shell-123"`);
  });

  it('should format failed kill', () => {
    const result = formatKillResult({
      error: 'Process not found',
      shellId: 'shell-456',
      success: false,
    });
    expect(result).toMatchInlineSnapshot(`"Failed to kill shell: Process not found"`);
  });

  it('should format failed kill without error message', () => {
    const result = formatKillResult({
      shellId: 'shell-789',
      success: false,
    });
    expect(result).toMatchInlineSnapshot(`"Failed to kill shell: undefined"`);
  });
});
