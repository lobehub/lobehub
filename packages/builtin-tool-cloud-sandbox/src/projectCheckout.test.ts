import { describe, expect, it } from 'vitest';

import { projectCheckoutDirectory } from './projectCheckout';
import { isSafeSandboxCwd } from './workspace';

describe('projectCheckoutDirectory', () => {
  const ENV_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

  it('keeps one folder per project and environment', () => {
    expect(projectCheckoutDirectory('proj_1', ENV_ID)).toBe(`projects/proj_1/${ENV_ID}`);
  });

  // A filled folder is never initialized again, so a shared folder would run
  // the second repository against the first one's checkout.
  it('keeps two repositories apart whatever they are called', () => {
    expect(projectCheckoutDirectory('proj_1', 'env-a')).not.toBe(
      projectCheckoutDirectory('proj_1', 'env-b'),
    );
  });

  it('turns anything but an id character into a plain one, so no segment escapes', () => {
    const folder = projectCheckoutDirectory('../proj', '..');

    expect(folder).toBe('projects/___proj/__');
    expect(isSafeSandboxCwd(folder)).toBe(true);
  });

  it('stays a usable working directory', () => {
    expect(isSafeSandboxCwd(projectCheckoutDirectory('proj_1', ENV_ID))).toBe(true);
  });
});
