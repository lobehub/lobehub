import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const dir = import.meta.dirname;
const header = readFileSync(path.join(dir, 'WorkbenchHeader.tsx'), 'utf8');
const brand = readFileSync(path.join(dir, 'WorkbenchBrandLink.tsx'), 'utf8');

const pageFiles = [
  '../features/acceptance/AcceptanceDetail.tsx',
  '../features/verify/VerifyDetail.tsx',
  '../features/verify/VerifyList.tsx',
] as const;

describe('WorkbenchHeader', () => {
  it('sends guests into the app with a single primary CTA', () => {
    expect(header).toContain("href={'/'}");
    expect(header).toContain("t('actions.goToApp'");
    expect(header).toContain("type={'primary'}");
    expect(header).not.toContain('/signin');
    expect(header).not.toContain('/signup');
  });

  it('labels the brand as entering the app, not returning to it', () => {
    expect(brand).toContain("t('actions.goToApp'");
    expect(brand).not.toContain("t('actions.backToApp'");
    expect(brand).toContain("href={'/'}");
  });

  it.each(pageFiles)('is mounted on %s', (relativePath) => {
    const source = readFileSync(path.join(dir, relativePath), 'utf8');

    expect(source).toContain('WorkbenchHeader');
    expect(source).not.toContain('WorkbenchBrandLink');
  });
});
