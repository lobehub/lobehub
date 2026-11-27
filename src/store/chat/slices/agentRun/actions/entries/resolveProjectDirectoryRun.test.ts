import { afterEach, describe, expect, it } from 'vitest';

import { OwnDeviceUnavailableError } from '@/helpers/agentOwnDevice';
import { useDeviceStore } from '@/store/device';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { resolveProjectDirectoryRun } from './resolveProjectDirectoryRun';

const run = (
  staged: Parameters<typeof resolveProjectDirectoryRun>[0]['staged'],
  agencyConfig = {},
) =>
  resolveProjectDirectoryRun({
    agencyConfig: { boundDeviceId: 'dev-1', executionTarget: 'device', ...agencyConfig },
    boundDirectoryId: undefined,
    isGatewayMode: true,
    staged,
  });

describe('resolveProjectDirectoryRun — project-only drafts', () => {
  // Review: Auto's sandbox used to rewrite the agent's own target through the
  // persistent setting, outliving the draft.
  it('runs an Auto sandbox draft in the sandbox for this send only', async () => {
    const result = await run({ agentId: 'agt', auto: true, projectId: 'prj' });

    expect(result.agencyConfig?.executionTarget).toBe('sandbox');
    expect(result.newTopicProject).toEqual({ projectId: 'prj' });
  });

  it("leaves a hand-picked project draft on the agent's own target", async () => {
    const result = await run({ agentId: 'agt', projectId: 'prj' });

    expect(result.agencyConfig?.executionTarget).toBe('device');
  });

  it('does not override an agent fixed to its target', async () => {
    const result = await run(
      { agentId: 'agt', auto: true, projectId: 'prj' },
      { executionTargetSelectionPolicy: 'fixed' },
    );

    expect(result.agencyConfig?.executionTarget).toBe('device');
  });
});

describe('resolveProjectDirectoryRun — an agent on its own device', () => {
  const claudeCode = { heterogeneousProvider: { type: 'claude-code' } };
  const cursor = { heterogeneousProvider: { type: 'cursor' } };
  const directory = (id: string, deviceId: string) =>
    ({ deviceId, id, projectId: 'prj', runnable: true }) as unknown as ProjectDirectory;
  const seed = (rows: ProjectDirectory[]) =>
    useProjectDirectoryStore.setState({ directoriesMap: { prj: rows } });
  afterEach(() => {
    useProjectDirectoryStore.setState({ directoriesMap: {} });
    setOnline([]);
  });

  it('runs Claude Code in the sandbox when Auto could not use its device, saying why', async () => {
    seed([directory('dir-own', 'dev-1')]);
    const result = await run({ agentId: 'agt', auto: true, projectId: 'prj' }, claudeCode);

    expect(result.agencyConfig?.executionTarget).toBe('sandbox');
    expect(result.ownDeviceFallback).toBe('offline');
  });

  it('refuses a device-only agent instead of moving it', async () => {
    seed([directory('dir-other', 'dev-2')]);

    await expect(run({ agentId: 'agt', auto: true, projectId: 'prj' }, cursor)).rejects.toEqual(
      new OwnDeviceUnavailableError('noDirectory'),
    );
  });

  const setOnline = (deviceIds: string[]) =>
    useDeviceStore.setState({
      deviceListMap: { all: deviceIds.map((deviceId) => ({ deviceId, online: true })) },
    } as never);

  it("does not follow a stale Auto draft onto another device's directory", async () => {
    seed([directory('dir-other', 'dev-2'), directory('dir-own', 'dev-1')]);
    setOnline(['dev-1', 'dev-2']);
    const result = await run(
      { agentId: 'agt', auto: true, projectWorkingDirectoryId: 'dir-other' },
      claudeCode,
    );

    expect(result.agencyConfig).toMatchObject({
      boundDeviceId: 'dev-1',
      executionTarget: 'device',
    });
    expect(result.newTopicProject).toEqual({
      projectId: 'prj',
      projectWorkingDirectoryId: 'dir-own',
    });
  });

  // Review: the retarget took the own device's folder even with that device
  // offline, so the server refused the send instead of the fallback applying.
  it('falls back instead of retargeting onto an offline own device', async () => {
    seed([directory('dir-other', 'dev-2'), directory('dir-own', 'dev-1')]);
    setOnline(['dev-2']);
    const result = await run(
      { agentId: 'agt', auto: true, projectWorkingDirectoryId: 'dir-other' },
      claudeCode,
    );

    expect(result.agencyConfig?.executionTarget).toBe('sandbox');
    expect(result.ownDeviceFallback).toBe('offline');
  });

  it('keeps a fallen-back conversation in the sandbox on later sends', async () => {
    const result = await resolveProjectDirectoryRun({
      agencyConfig: { boundDeviceId: 'dev-1', executionTarget: 'device', ...claudeCode },
      boundDirectoryId: undefined,
      boundTopic: { projectId: 'prj' },
      isGatewayMode: true,
      staged: undefined,
    });

    expect(result.agencyConfig?.executionTarget).toBe('sandbox');
  });

  it('leaves a regular agent and a hand-picked device draft alone', async () => {
    const regular = await resolveProjectDirectoryRun({
      agencyConfig: { boundDeviceId: 'dev-1', executionTarget: 'device' },
      boundDirectoryId: undefined,
      boundTopic: { projectId: 'prj' },
      isGatewayMode: true,
      staged: undefined,
    });
    expect(regular.agencyConfig?.executionTarget).toBe('device');

    seed([directory('dir-other', 'dev-2')]);
    const picked = await run(
      { agentId: 'agt', projectWorkingDirectoryId: 'dir-other' },
      claudeCode,
    );
    expect(picked.agencyConfig?.boundDeviceId).toBe('dev-2');
  });
});
