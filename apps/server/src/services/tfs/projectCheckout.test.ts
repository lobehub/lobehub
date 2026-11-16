import { describe, expect, it } from 'vitest';

import { isPersonalTfsProjectCheckout } from './projectCheckout';

const configuration = {
  sources: [{ kind: 'git', url: 'https://dev.example.com/Collection/P/_git/R' }],
};
const topic = {
  projectId: 'p',
  metadata: {
    sandboxEnvironmentId: 'e',
    sandboxWorkingDirectory: 'projects/p/e',
    sandboxDrive: 'public' as const,
  },
};

describe('personal TFS project checkout', () => {
  it('repairs the automatic public-drive choice of older TFS project conversations', () => {
    expect(isPersonalTfsProjectCheckout(topic, configuration)).toBe(true);
  });

  it('does not relocate a GitHub checkout', () => {
    expect(
      isPersonalTfsProjectCheckout(topic, {
        sources: [{ kind: 'git', url: 'https://github.com/o/r' }],
      }),
    ).toBe(false);
  });

  it('does not relocate explicit folders, legacy instances or unbound topics', () => {
    expect(
      isPersonalTfsProjectCheckout(
        { ...topic, metadata: { ...topic.metadata, sandboxWorkingDirectory: 'shared-work' } },
        configuration,
      ),
    ).toBe(false);
    expect(
      isPersonalTfsProjectCheckout(
        { ...topic, metadata: { ...topic.metadata, sandboxInstanceId: 'instance' } },
        configuration,
      ),
    ).toBe(false);
    expect(isPersonalTfsProjectCheckout({ ...topic, projectId: null }, configuration)).toBe(false);
  });
});
