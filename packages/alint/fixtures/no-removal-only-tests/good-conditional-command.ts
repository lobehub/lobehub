import { expect, it } from 'vitest';

import { createProgramForCapabilities } from './commands';

it('omits device commands only when the host has no device capability', () => {
  const unsupported = createProgramForCapabilities({ device: false });
  const supported = createProgramForCapabilities({ device: true });
  expect(unsupported.helpInformation()).not.toContain('device');
  expect(supported.helpInformation()).toContain('device');
});
