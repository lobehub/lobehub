import { describe, expect, it } from 'vitest';

import {
  copyChipLabel,
  copyMenuActions,
  describeEnvironmentRow,
  pickCopyForEnvironment,
  type PickerCopy,
} from '../sandboxEnvironmentRows';

const copy = (id: string, minute: number, overrides: Partial<PickerCopy> = {}): PickerCopy => ({
  createdAt: new Date(Date.UTC(2026, 9, 1, 0, minute)),
  environmentId: 'env-1',
  id,
  inUse: false,
  inUseByThisTopic: false,
  status: 'ready',
  ...overrides,
});

const busy = { inUse: true, inUseByThisTopic: false };

describe('pickCopyForEnvironment', () => {
  it('keeps the copy this conversation is already bound to, even when the default is free', () => {
    const copies = [copy('default', 0), copy('second', 1)];

    expect(pickCopyForEnvironment(copies, 'second')?.id).toBe('second');
  });

  it('keeps the bound copy even when another run holds it', () => {
    const copies = [copy('default', 0), copy('second', 1, busy)];

    expect(pickCopyForEnvironment(copies, 'second')?.id).toBe('second');
  });

  it('picks the default (earliest) copy when nothing here is bound', () => {
    // Listed out of order on purpose: the rule reads createdAt, not position.
    const copies = [copy('second', 5), copy('default', 0), copy('third', 9)];

    expect(pickCopyForEnvironment(copies, 'somewhere-else')?.id).toBe('default');
  });

  it('falls through to the first free copy when the default is occupied', () => {
    const copies = [copy('default', 0, busy), copy('third', 9), copy('second', 5)];

    expect(pickCopyForEnvironment(copies, undefined)?.id).toBe('second');
  });

  it('skips a copy that is still building', () => {
    const copies = [
      copy('default', 0, busy),
      copy('second', 5, { status: 'pending' }),
      copy('third', 9),
    ];

    expect(pickCopyForEnvironment(copies, undefined)?.id).toBe('third');
  });

  it("treats this conversation's own run as free", () => {
    const copies = [copy('default', 0, { inUse: true, inUseByThisTopic: true }), copy('second', 5)];

    expect(pickCopyForEnvironment(copies, undefined)?.id).toBe('default');
  });

  it('picks nothing when every copy is taken', () => {
    const copies = [copy('default', 0, busy), copy('second', 5, busy)];

    expect(pickCopyForEnvironment(copies, undefined)).toBeUndefined();
  });
});

describe('describeEnvironmentRow', () => {
  it('shows a single copy as one row with no second menu', () => {
    const row = describeEnvironmentRow({
      copies: [copy('only', 0)],
      isCreator: true,
      kind: 'code',
    });

    expect(row).toMatchObject({ hasSubmenu: false, lazyCreate: false, selectable: true });
    expect(row.picked?.id).toBe('only');
  });

  it('offers the second menu only with several copies, default first', () => {
    const row = describeEnvironmentRow({
      copies: [copy('second', 5), copy('default', 0)],
      isCreator: false,
      kind: 'code',
    });

    expect(row.hasSubmenu).toBe(true);
    expect(row.copies.map((item) => item.id)).toEqual(['default', 'second']);
  });

  it('never offers a second menu on a files environment, however many copies it has', () => {
    const row = describeEnvironmentRow({
      boundInstanceId: 'second',
      copies: [copy('default', 0), copy('second', 5)],
      isCreator: true,
      kind: 'files',
    });

    expect(row.hasSubmenu).toBe(false);
    // The conversation stays on the copy it is already bound to.
    expect(row.picked?.id).toBe('second');
  });

  it('cannot be picked when every copy is taken, and shows the default copy state', () => {
    const row = describeEnvironmentRow({
      copies: [copy('default', 0, busy), copy('second', 5, busy)],
      isCreator: true,
      kind: 'code',
    });

    expect(row.selectable).toBe(false);
    expect(row.picked).toBeUndefined();
    expect(row.displayed?.id).toBe('default');
  });

  it('shows the state of the copy a click would bind', () => {
    const row = describeEnvironmentRow({
      copies: [copy('default', 0, busy), copy('second', 5, { status: 'error' })],
      isCreator: true,
      kind: 'code',
    });

    expect(row.displayed?.id).toBe('second');
    expect(row.displayed?.status).toBe('error');
  });

  it('creates the copy on first pick for the creator of an environment with none', () => {
    const row = describeEnvironmentRow({ copies: [], isCreator: true, kind: 'code' });

    expect(row).toMatchObject({ hasSubmenu: false, lazyCreate: true, selectable: true });
  });

  it('leaves a colleague unable to pick a published environment with no copy', () => {
    const row = describeEnvironmentRow({ copies: [], isCreator: false, kind: 'code' });

    expect(row).toMatchObject({ lazyCreate: false, selectable: false });
  });
});

describe('copyMenuActions', () => {
  it('offers stop and open-another-copy to the creator of a code environment', () => {
    expect(copyMenuActions({ copy: copy('a', 0, busy), isCreator: true, kind: 'code' })).toEqual([
      'stop',
      'reopen',
    ]);
  });

  it('offers only stop on a files environment', () => {
    expect(copyMenuActions({ copy: copy('a', 0, busy), isCreator: true, kind: 'files' })).toEqual([
      'stop',
    ]);
  });

  it('offers nothing to a colleague', () => {
    expect(copyMenuActions({ copy: copy('a', 0, busy), isCreator: false, kind: 'code' })).toEqual(
      [],
    );
    expect(copyMenuActions({ copy: copy('a', 0, busy), isCreator: false, kind: 'files' })).toEqual(
      [],
    );
  });

  it('has no stop while nothing else holds the copy', () => {
    expect(copyMenuActions({ copy: copy('a', 0), isCreator: true, kind: 'code' })).toEqual([
      'reopen',
    ]);
    expect(copyMenuActions({ copy: copy('a', 0), isCreator: true, kind: 'files' })).toEqual([]);
  });

  it('cannot stop a build', () => {
    expect(
      copyMenuActions({
        copy: copy('a', 0, { ...busy, status: 'pending' }),
        isCreator: true,
        kind: 'code',
      }),
    ).toEqual(['reopen']);
  });
});

describe('copyChipLabel', () => {
  it('names only the environment when it has one copy', () => {
    expect(copyChipLabel({ copy: { name: 'web' }, copyCount: 1, environmentName: 'Web' })).toBe(
      'Web',
    );
  });

  it('names the environment and the copy when there are several', () => {
    expect(copyChipLabel({ copy: { name: 'web-2' }, copyCount: 2, environmentName: 'Web' })).toBe(
      'Web · web-2',
    );
  });

  it('falls back to the copy name when the environment is unknown', () => {
    expect(copyChipLabel({ copy: { name: 'web-2' }, copyCount: 2 })).toBe('web-2');
  });
});
