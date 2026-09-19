import { describe, expect, it } from 'vitest';

import { isImportableChannel, planChannelImport } from './importPlan';

describe('planChannelImport', () => {
  it('lands an entry that carries credentials as the file asked', () => {
    const [step] = planChannelImport([
      {
        applicationId: 'app-1',
        credentials: { botToken: 't' },
        enabled: true,
        platform: 'discord',
      },
    ]);

    expect(step.enabled).toBeUndefined();
    expect(step.connect).toBe(true);
  });

  it('lands a credential-less entry switched off, and does not connect it', () => {
    // It cannot work without a secret, so it must not look like a live channel.
    const [step] = planChannelImport([
      { applicationId: 'app-1', enabled: true, platform: 'discord' },
    ]);

    expect(step.enabled).toBe(false);
    expect(step.connect).toBe(false);
  });

  it('treats an empty credentials object the same as none', () => {
    const [step] = planChannelImport([
      { applicationId: 'app-1', credentials: {}, enabled: true, platform: 'discord' },
    ]);

    expect(step.enabled).toBe(false);
  });

  it('leaves a disabled entry disabled even with credentials', () => {
    const [step] = planChannelImport([
      { applicationId: 'app-1', credentials: { botToken: 't' }, platform: 'discord' },
    ]);

    expect(step.connect).toBe(false);
  });
});

describe('isImportableChannel', () => {
  it.each([
    [{ applicationId: 'a', platform: 'discord' }, true],
    [{ applicationId: 'a' }, false],
    [{ platform: 'discord' }, false],
    [{}, false],
  ])('%o → %s', (item, expected) => {
    expect(isImportableChannel(item)).toBe(expected);
  });
});
