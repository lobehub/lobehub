import { describe, expect, it } from 'vitest';

import { formatMoveResults } from './formatMoveResults';

describe('formatMoveResults', () => {
  it('should format all successful moves', () => {
    const results = [{ success: true }, { success: true }, { success: true }];
    const result = formatMoveResults(results);
    expect(result).toMatchInlineSnapshot(`"Successfully moved 3 item(s)."`);
  });

  it('should format all failed moves', () => {
    const results = [{ success: false }, { success: false }];
    const result = formatMoveResults(results);
    expect(result).toMatchInlineSnapshot(`"Failed to move all 2 item(s)."`);
  });

  it('should format partial success', () => {
    const results = [{ success: true }, { success: false }, { success: true }];
    const result = formatMoveResults(results);
    expect(result).toMatchInlineSnapshot(
      `"Moved 2 item(s) successfully. Failed to move 1 item(s)."`,
    );
  });

  it('should handle single item success', () => {
    const results = [{ success: true }];
    const result = formatMoveResults(results);
    expect(result).toMatchInlineSnapshot(`"Successfully moved 1 item(s)."`);
  });

  it('should handle single item failure', () => {
    const results = [{ success: false }];
    const result = formatMoveResults(results);
    expect(result).toMatchInlineSnapshot(`"Failed to move all 1 item(s)."`);
  });
});
