import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getServiceRestartCommand, readConnectServices } from './status';

const state = vi.hoisted(() => ({
  errorScopes: new Set<string>(),
  output: { system: 'LoadState=not-found', user: 'LoadState=not-found' },
}));
const execFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile }));

const loaded =
  'LoadState=loaded\nActiveState=active\nSubState=running\nUnitFileState=enabled\nMainPID=4567\nUser=ubuntu\nFragmentPath=/etc/systemd/system/lobehub-connect.service';

describe('connect service discovery', () => {
  beforeEach(() => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    state.errorScopes.clear();
    state.output = { system: 'LoadState=not-found', user: 'LoadState=not-found' };
    execFile.mockReset().mockImplementation((_command, args, _options, callback) => {
      const scope = args.includes('--system') ? 'system' : 'user';
      callback(
        state.errorScopes.has(scope) ? new Error('systemctl failed') : null,
        state.output[scope],
      );
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('finds a system service even when the user manager is unavailable', async () => {
    state.output = { system: loaded, user: '' };
    state.errorScopes.add('user');
    const result = await readConnectServices();

    expect(result.unavailableScopes).toEqual(['user']);
    expect(result.services).toMatchObject([
      {
        active: true,
        mainPid: 4567,
        scope: 'system',
        user: 'ubuntu',
        fragmentPath: '/etc/systemd/system/lobehub-connect.service',
      },
    ]);
    expect(getServiceRestartCommand(result.services[0])).toBe(
      'sudo systemctl --no-block restart lobehub-connect.service',
    );
  });

  it('reports both scopes instead of hiding the system service behind an inactive user unit', async () => {
    state.output = {
      system: loaded,
      user: loaded
        .replace('ActiveState=active', 'ActiveState=inactive')
        .replace('MainPID=4567', 'MainPID=0'),
    };
    const { services } = await readConnectServices();
    expect(services).toHaveLength(2);
    expect(services[0]).toMatchObject({ active: false, mainPid: null, scope: 'user' });
    expect(getServiceRestartCommand(services[0])).toBe(
      'systemctl --user --no-block restart lobehub-connect.service',
    );
    expect(services[1]).toMatchObject({ active: true, mainPid: 4567, scope: 'system' });
  });

  it('treats not-found as absence even when systemctl exits nonzero', async () => {
    state.errorScopes.add('system');
    expect(await readConnectServices()).toEqual({ services: [], unavailableScopes: [] });
  });

  it('does not turn an unreadable manager into a claim that no service is installed', async () => {
    state.output = { system: '', user: '' };
    state.errorScopes.add('system');
    state.errorScopes.add('user');
    expect(await readConnectServices()).toEqual({
      services: [],
      unavailableScopes: ['user', 'system'],
    });
  });

  it('does not invoke systemctl on other platforms', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    expect(await readConnectServices()).toEqual({ services: [], unavailableScopes: [] });
    expect(execFile).not.toHaveBeenCalled();
  });
});
