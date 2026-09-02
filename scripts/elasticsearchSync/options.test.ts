import { describe, expect, it } from 'vitest';

import { parseElasticsearchFtsSearchSyncCliOptions } from './options';

describe('parseElasticsearchFtsSearchSyncCliOptions', () => {
  it('defaults to one bounded drain step', () => {
    expect(parseElasticsearchFtsSearchSyncCliOptions([])).toEqual({ maxSteps: 1, yes: false });
  });

  it('accepts explicit acknowledgement and a bounded step count', () => {
    expect(parseElasticsearchFtsSearchSyncCliOptions(['--max-steps=8', '--yes'])).toEqual({
      maxSteps: 8,
      yes: true,
    });
  });

  it.each(['--max-steps=0', '--max-steps=101', '--max-steps=1.5', '--max-steps=01'])(
    'rejects invalid bounded step count %s',
    (argument) => {
      expect(() => parseElasticsearchFtsSearchSyncCliOptions([argument])).toThrow(
        '--max-steps must be an integer between 1 and 100',
      );
    },
  );

  it('accepts an optional interval for the long-running Compose worker mode', () => {
    expect(
      parseElasticsearchFtsSearchSyncCliOptions([
        '--max-steps=8',
        '--interval-seconds=15',
        '--yes',
      ]),
    ).toEqual({ intervalSeconds: 15, maxSteps: 8, yes: true });
    expect(parseElasticsearchFtsSearchSyncCliOptions(['--yes'])).not.toHaveProperty(
      'intervalSeconds',
    );
  });

  it.each(['--interval-seconds=0', '--interval-seconds=3601', '--interval-seconds=1.5'])(
    'rejects invalid interval %s',
    (argument) => {
      expect(() => parseElasticsearchFtsSearchSyncCliOptions([argument])).toThrow(
        '--interval-seconds must be an integer between 1 and 3600',
      );
    },
  );

  it('rejects duplicate or unknown arguments', () => {
    expect(() =>
      parseElasticsearchFtsSearchSyncCliOptions(['--max-steps=1', '--max-steps=2']),
    ).toThrow('--max-steps can only be provided once');
    expect(() => parseElasticsearchFtsSearchSyncCliOptions(['--forever'])).toThrow(
      'Unknown argument: --forever',
    );
    expect(() => parseElasticsearchFtsSearchSyncCliOptions(['unexpected'])).toThrow(
      'Unknown argument: unexpected',
    );
  });
});
