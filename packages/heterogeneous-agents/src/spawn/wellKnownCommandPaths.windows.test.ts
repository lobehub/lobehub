import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getWellKnownCommandPaths } from './wellKnownCommandPaths';

const platformMock = vi.hoisted(() => vi.fn());

vi.mock('node:os', () => ({ homedir: vi.fn(), platform: platformMock }));

const originalLocalAppData = process.env.LOCALAPPDATA;

describe('getWellKnownCommandPaths on Windows', () => {
  beforeEach(() => {
    platformMock.mockReturnValue('win32');
    process.env.LOCALAPPDATA = 'C:\\Users\\x\\AppData\\Local';
  });

  afterEach(() => {
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
  });

  it('finds the official Cursor CLI launchers when PATH is missing them', () => {
    expect(getWellKnownCommandPaths('cursor')).toEqual([
      path.win32.join(process.env.LOCALAPPDATA!, 'cursor-agent', 'agent.cmd'),
      path.win32.join(process.env.LOCALAPPDATA!, 'cursor-agent', 'cursor-agent.cmd'),
    ]);
  });
});
