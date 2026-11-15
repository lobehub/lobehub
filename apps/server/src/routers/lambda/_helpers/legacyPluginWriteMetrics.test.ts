// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recordLegacyPluginWrite, toClientVersionLabel } from './legacyPluginWriteMetrics';

const counter = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock('@lobechat/observability-otel/modules/legacy-plugin-write', () => ({
  legacyPluginWriteCounter: counter,
}));
// The server's own version bounds the labels
vi.mock('@lobechat/const', () => ({ CURRENT_VERSION: '2.3.3' }));

describe('toClientVersionLabel', () => {
  const server = '2.3.3';

  it.each([
    ['2.3.3', '2.3'],
    ['v2.3.1', '2.3'],
    ['2.3.0-canary.12', '2.3'],
    ['2.1.1-nightly.20261114', '2.1'],
    ['2.0.0', '2.0'],
  ])('labels the release %s by its release line %s', (version, label) => {
    expect(toClientVersionLabel(version, server)).toBe(label);
  });

  // A header can carry any version: past what this server ships, every value
  // shares one label instead of opening a series each
  it.each([['2.4.0'], ['2.9.4-canary.1'], ['3.0.0'], ['9999.9999.999999']])(
    'labels %s, past the server, as newer',
    (version) => {
      expect(toClientVersionLabel(version, server)).toBe('newer');
    },
  );

  it.each([['1.143.2'], ['0.0.0-nightly.pr22902.39193'], ['1.0.0-canary.123456']])(
    'labels %s, of an older major, as older',
    (version) => {
      expect(toClientVersionLabel(version, server)).toBe('older');
    },
  );

  it('keeps fabricated pre-releases of one line to one label', () => {
    const labels = new Set(
      Array.from({ length: 50 }, (_, i) => toClientVersionLabel(`2.3.0-canary.${i}`, server)),
    );

    expect([...labels]).toEqual(['2.3']);
  });

  it.each([['latest'], ['2.1'], ['2.1.4; DROP TABLE'], ['user-1234'], ['1.2.3-'.padEnd(60, 'x')]])(
    'collapses the non-release version %s into other',
    (version) => {
      expect(toClientVersionLabel(version, server)).toBe('other');
    },
  );

  it('labels a missing version as none', () => {
    expect(toClientVersionLabel(undefined, server)).toBe('none');
  });

  it("bounds the labels by this server's version by default", () => {
    expect(toClientVersionLabel('2.3.9')).toBe('2.3');
    expect(toClientVersionLabel('2.4.0')).toBe('newer');
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
      client_version: '2.1',
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
