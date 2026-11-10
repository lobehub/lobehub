import { describe, expect, it } from 'vitest';

import { projectCheckoutDirectory } from './projectCheckout';
import { isSafeSandboxCwd } from './workspace';

describe('projectCheckoutDirectory', () => {
  const env = (name: string, id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301') => ({ id, name });

  it('keeps one folder per project and repository, named after the repository', () => {
    expect(projectCheckoutDirectory('proj_1', env('lobehub-biz/agent-mail'))).toBe(
      'projects/proj_1/agent-mail-3f2504e0',
    );
  });

  // A filled folder is never initialized again, so a shared folder would run
  // the second repository against the first one's checkout.
  it('keeps two repositories of one name apart', () => {
    const a = projectCheckoutDirectory('proj_1', env('orgA/api', 'aaaaaaaa-0000'));
    const b = projectCheckoutDirectory('proj_1', env('orgB/api', 'bbbbbbbb-0000'));

    expect(a).not.toBe(b);
  });

  it('strips what a path cannot hold, and stays a usable working directory', () => {
    const folder = projectCheckoutDirectory('proj_1', env('../my repo!'));

    expect(folder).toBe('projects/proj_1/my-repo-3f2504e0');
    expect(isSafeSandboxCwd(folder)).toBe(true);
  });

  it('names a repository it cannot read after nothing in particular', () => {
    expect(projectCheckoutDirectory('proj_1', env('...'))).toBe(
      'projects/proj_1/repository-3f2504e0',
    );
  });
});
