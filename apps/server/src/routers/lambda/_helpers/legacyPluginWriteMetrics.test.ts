// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recordLegacyPluginWrite, toClientVersionLabel } from './legacyPluginWriteMetrics';

const counter = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock('@lobechat/observability-otel/modules/legacy-plugin-write', () => ({
  legacyPluginWriteCounter: counter,
}));

describe('toClientVersionLabel', () => {
  it.each([
    ['2.1.4', '2.1.4'],
    ['v2.1.4', '2.1.4'],
    ['2.2.0-canary.12', '2.2.0-canary.12'],
    ['2.2.0-nightly', '2.2.0-nightly'],
    ['2.1.1-nightly.20261114', '2.1.1-nightly.20261114'],
  ])('keeps the release version %s', (version, label) => {
    expect(toClientVersionLabel(version)).toBe(label);
  });

  it.each([['latest'], ['2.1'], ['2.1.4; DROP TABLE'], ['user-1234'], ['1.2.3-'.padEnd(60, 'x')]])(
    'collapses the non-release version %s into other',
    (version) => {
      expect(toClientVersionLabel(version)).toBe('other');
    },
  );

  it('labels a missing version as none', () => {
    expect(toClientVersionLabel(undefined)).toBe('none');
  });
});

describe('recordLegacyPluginWrite', () => {
  beforeEach(() => {
    counter.add.mockClear();
  });

  it('counts one call labelled by procedure, plugin type and client', () => {
    recordLegacyPluginWrite('createOrInstallPlugin', 'plugin', {
      type: 'desktop',
      version: '2.1.4',
    });

    expect(counter.add).toHaveBeenCalledWith(1, {
      client_type: 'desktop',
      client_version: '2.1.4',
      plugin_type: 'plugin',
      procedure: 'createOrInstallPlugin',
    });
  });

  it('counts a call without client metadata as an unknown client', () => {
    recordLegacyPluginWrite('createPlugin', 'customPlugin', undefined);

    expect(counter.add).toHaveBeenCalledWith(1, {
      client_type: 'unknown',
      client_version: 'none',
      plugin_type: 'customPlugin',
      procedure: 'createPlugin',
    });
  });
});
