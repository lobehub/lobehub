// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { resolveFtsSearchMigrationCommand } from '../commandOptions';

describe('migration command intent', () => {
  it('defaults to read-only status', () => {
    expect(resolveFtsSearchMigrationCommand([]).command).toBe('status');
  });

  it.each(['retire', 'purge', 'promote'])(
    'requires explicit confirmation and entities for %s',
    (command) => {
      expect(() => resolveFtsSearchMigrationCommand([`--${command}`, '--entity=messages'])).toThrow(
        '--yes',
      );
      expect(() => resolveFtsSearchMigrationCommand([`--${command}`, '--yes'])).toThrow('--entity');
      expect(
        resolveFtsSearchMigrationCommand([`--${command}`, '--yes', '--entity=messages']).command,
      ).toBe(command);
    },
  );

  it.each([
    ['--retire', '--purge'],
    ['--status', '--apply'],
    ['--promote', '--retire'],
    ['--skip-failure=messages:1', '--purge'],
  ])('rejects combined operations %s %s', (...args) => {
    expect(() => resolveFtsSearchMigrationCommand([...args, '--yes', '--entity=messages'])).toThrow(
      'exactly one',
    );
  });

  it('requires an exact lock owner and a separate recovery command', () => {
    const owner = '00000000-0000-4000-8000-000000000001';
    expect(resolveFtsSearchMigrationCommand([`--release-lock=${owner}`, '--yes'])).toEqual({
      command: 'release-lock',
      releaseLockOwner: owner,
    });
    expect(() => resolveFtsSearchMigrationCommand(['--release-lock=', '--yes'])).toThrow('UUID');
    expect(() =>
      resolveFtsSearchMigrationCommand([`--release-lock=${owner}`, '--apply', '--yes']),
    ).toThrow('exactly one');
  });

  it.each([
    ['--in-place'],
    ['--apply', '--in-place', '--fresh-run', '--yes'],
    ['--fresh-run'],
    ['--version=2'],
    ['--apply', '--rebuild-current', '--yes'],
    ['--apply', '--rebuild-current', '--fresh-run', '--entity=messages', '--yes'],
    ['--apply', '--run-id=00000000-0000-4000-8000-000000000001', '--yes'],
    ['--promote', '--generation=search-messages-v1', '--version=1', '--entity=messages', '--yes'],
  ])('rejects misplaced modifiers %s', (...args) => {
    expect(() => resolveFtsSearchMigrationCommand(args)).toThrow();
  });

  it('accepts an explicit current-version rebuild and its run-id resume', () => {
    expect(
      resolveFtsSearchMigrationCommand([
        '--apply',
        '--rebuild-current',
        '--entity=messages',
        '--yes',
      ]).command,
    ).toBe('apply');
    expect(
      resolveFtsSearchMigrationCommand([
        '--apply',
        '--rebuild-current',
        '--run-id=00000000-0000-4000-8000-000000000001',
        '--entity=messages',
        '--yes',
      ]).command,
    ).toBe('apply');
  });

  it('accepts the confirmed startup coordinator command', () => {
    expect(resolveFtsSearchMigrationCommand(['--startup', '--yes']).command).toBe('startup');
    expect(() => resolveFtsSearchMigrationCommand(['--startup'])).toThrow('--yes');
  });

  it.each([
    '--entity=messages',
    '--fresh-run',
    '--in-place',
    '--max-batches-per-entity=1',
    '--version=2',
    '--rebuild-current',
  ])('rejects partial or operator-only startup option %s', (option) => {
    expect(() => resolveFtsSearchMigrationCommand(['--startup', '--yes', option])).toThrow(
      'cannot be used with --startup',
    );
  });
});
