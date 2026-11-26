import { describe, expect, it, vi } from 'vitest';

import { ActivatorExecutionRuntime, type ToolManifestInfo } from '../index';

const webBrowsingManifest: ToolManifestInfo = {
  apiDescriptions: [{ description: 'Search the web.', name: 'search' }],
  identifier: 'lobe-web-browsing',
  name: 'Web Browsing',
};

const LOCK_REASON = 'Device switching is off for this run: it is locked to device "device-a".';

const buildRuntime = () =>
  new ActivatorExecutionRuntime({
    service: {
      explainNotFound: (identifier) =>
        identifier === 'lobe-remote-device' ? LOCK_REASON : undefined,
      getActivatedToolIds: () => [],
      getToolManifests: vi.fn(async (identifiers: string[]) =>
        [webBrowsingManifest].filter((m) => identifiers.includes(m.identifier)),
      ),
      markActivated: vi.fn(),
    },
  });

describe('ActivatorExecutionRuntime.activateTools — withheld tools', () => {
  it('records the reason in state, so a later rewrite of the result can keep it', async () => {
    // The result text is rebuilt from `state` once the activated tool's docs
    // move to the system prompt (ActivationResultTrimProcessor). A reason that
    // lives only in the text is lost there, and the model is left with a bare
    // "Not found" for a tool it can see is installed.
    const result = await buildRuntime().activateTools({
      identifiers: ['lobe-web-browsing', 'lobe-remote-device', 'nonexistent'],
      reason: 'test',
    });

    expect(result.content).toContain(`Not available: lobe-remote-device. ${LOCK_REASON}`);
    expect(result.content).toContain('Not found: nonexistent');
    expect(result.state?.notAvailable).toEqual([
      { identifier: 'lobe-remote-device', reason: LOCK_REASON },
    ]);
    // `notFound` stays the full list of what could not be activated: the
    // inspector counts it, and older readers know no other field.
    expect(result.state?.notFound).toEqual(['lobe-remote-device', 'nonexistent']);
  });

  it('leaves `notAvailable` empty when the host explains nothing', async () => {
    const result = await buildRuntime().activateTools({
      identifiers: ['lobe-web-browsing', 'nonexistent'],
      reason: 'test',
    });

    expect(result.state?.notAvailable).toEqual([]);
    expect(result.state?.notFound).toEqual(['nonexistent']);
  });
});
