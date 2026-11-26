// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { describeProjectEnvironment, orderProjectRunners } from './projectRunners';

vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: {} }));

const folder = (deviceId: string, sortOrder = 0, runnable = true) => ({
  deviceId,
  deviceName: `${deviceId} name`,
  path: `/work/${deviceId}`,
  platform: 'linux',
  runnable,
  sortOrder,
});

describe('orderProjectRunners', () => {
  it('puts folders before the sandbox on a tie and keeps their own order', () => {
    const runners = orderProjectRunners([folder('a'), folder('b')], 0);

    expect(runners.map((r) => (r.kind === 'sandbox' ? 'sandbox' : r.name))).toEqual([
      'a name',
      'b name',
      'sandbox',
    ]);
  });

  it('follows a sandbox the project moved first', () => {
    const runners = orderProjectRunners([folder('a', 1)], -1);

    expect(runners[0]).toEqual({ kind: 'sandbox' });
  });

  it('leaves out a folder no run can start in', () => {
    const runners = orderProjectRunners([folder('a', 0, false)], 0);

    expect(runners).toEqual([{ kind: 'sandbox' }]);
  });

  it('says online or offline from the gateway, and unknown without it', () => {
    const [known, other] = orderProjectRunners([folder('a'), folder('b')], 0, new Set(['a']));
    const [unknown] = orderProjectRunners([folder('a')], 0);

    expect(known).toMatchObject({ online: true });
    expect(other).toMatchObject({ online: false });
    expect(unknown).toMatchObject({ online: undefined });
  });
});

describe('describeProjectEnvironment', () => {
  it('passes the repositories, setup and notes, and only the names of the variables', () => {
    const environment = describeProjectEnvironment({
      bootstrapCommand: 'pnpm install',
      env: { API_TOKEN: 'secret-value' },
      notes: 'dev needs 8 GB of memory',
      sources: [{ kind: 'git', ref: 'main', url: 'https://github.com/lobehub/lobe-pet' }],
    });

    expect(environment).toEqual({
      bootstrapCommand: 'pnpm install',
      envNames: ['API_TOKEN'],
      notes: 'dev needs 8 GB of memory',
      repositories: [{ ref: 'main', url: 'https://github.com/lobehub/lobe-pet' }],
    });
    expect(JSON.stringify(environment)).not.toContain('secret-value');
  });
});
