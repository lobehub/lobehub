import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Regression: Persian signup must keep name fields RTL-aligned and show the
 * email placeholder on the right (not pinned left by type=email / UA LTR).
 */
describe('BetterAuthSignUpForm RTL field alignment', () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'BetterAuthSignUpForm.tsx'),
    'utf8',
  );

  it('does not put type=email on the email Input (keeps inputMode + rule validation)', () => {
    expect(source).toContain('inputMode="email"');
    expect(source).toContain("type: 'email'");
    expect(source).not.toMatch(/<Input[\s\S]*?type=["']email["']/);
  });

  it('forces RTL placeholder alignment for the email field under dir=rtl', () => {
    expect(source).toContain("html[dir='rtl'] &:placeholder-shown");
    expect(source).toContain('direction: rtl');
    expect(source).toContain('text-align: start');
  });

  it('keeps name inputs RTL under dir=rtl and prevents grid overflow clipping', () => {
    expect(source).toContain('nameInput');
    expect(source).toContain('nameFieldLabel');
    expect(source).toContain('labelWrap');
    expect(source).toContain('min-width: 0');
    expect(source).toMatch(/\.ant-form-item-label\s*\{[\s\S]*?text-align:\s*start/);
    expect(source).toMatch(/\.ant-form-item-label > label\s*\{[\s\S]*?width:\s*100%/);
  });
});
