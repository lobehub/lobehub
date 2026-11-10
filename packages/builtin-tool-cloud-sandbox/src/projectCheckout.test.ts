import { describe, expect, it } from 'vitest';

import { projectCheckoutDirectory } from './projectCheckout';
import { isSafeSandboxCwd } from './workspace';

describe('projectCheckoutDirectory', () => {
  it('keeps one folder per project and repository', () => {
    expect(projectCheckoutDirectory('proj_1', 'lobehub-biz/agent-mail')).toBe(
      'projects/proj_1/agent-mail',
    );
  });

  it('strips what a path cannot hold, and stays a usable working directory', () => {
    const folder = projectCheckoutDirectory('proj_1', '../my repo!');

    expect(folder).toBe('projects/proj_1/my-repo');
    expect(isSafeSandboxCwd(folder)).toBe(true);
  });

  it('names a repository it cannot read after nothing in particular', () => {
    expect(projectCheckoutDirectory('proj_1', '...')).toBe('projects/proj_1/repository');
  });
});
