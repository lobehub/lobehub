import { describe, expect, it } from 'vitest';

import plugin from '../../locales/src/default/plugin';
import { DASHBOARD_DRY_RUN_AUDIT } from './interventionAudit';
import { DashboardManifest } from './manifest';
import { DashboardApiName, DashboardIdentifier } from './types';

describe('DashboardManifest', () => {
  it('declares exactly one API per ApiName, each with an Inspector label', () => {
    expect(DashboardManifest.api.map((api) => api.name).sort()).toEqual(
      Object.values(DashboardApiName).sort(),
    );
    for (const name of Object.values(DashboardApiName)) {
      expect(plugin).toHaveProperty([`builtins.${DashboardIdentifier}.apiName.${name}`]);
    }
  });

  it('never lets an agent publish without the user, even in auto-run mode', () => {
    const publish = DashboardManifest.api.find(
      (api) => api.name === DashboardApiName.requestPublish,
    );
    // `required` could be bypassed by auto-run; `always` cannot.
    expect(publish?.humanIntervention).toBe('always');
  });

  it('asks before dry-running credentialed or networked code, and only then', () => {
    const intervened = DashboardManifest.api.filter((api) => api.humanIntervention);
    expect(intervened.map((api) => api.name).sort()).toEqual(
      [DashboardApiName.dryRunWidget, DashboardApiName.requestPublish].sort(),
    );

    const dryRun = DashboardManifest.api.find((api) => api.name === DashboardApiName.dryRunWidget);
    expect(dryRun?.humanIntervention).toEqual({
      dynamic: { default: 'never', policy: 'always', type: DASHBOARD_DRY_RUN_AUDIT },
    });
    expect(dryRun?.parameters.required).toEqual(expect.arrayContaining(['versionId']));
    expect(DashboardManifest.systemRole).toContain('only runs after the user approves');
  });

  it('makes the model name the exact version the user approves', () => {
    const publish = DashboardManifest.api.find(
      (api) => api.name === DashboardApiName.requestPublish,
    );
    expect(publish?.parameters.required).toEqual(expect.arrayContaining(['versionId']));
  });

  it('teaches the output contract and the secret rules', () => {
    for (const type of ['stat', 'list', 'series', 'table']) {
      expect(DashboardManifest.systemRole).toContain(`"type":"${type}"`);
    }
    expect(DashboardManifest.systemRole).toContain('manifest.env');
    expect(DashboardManifest.systemRole).toContain('never write a token');
    expect(DashboardManifest.systemRole).toContain('manifest.network.allow');
  });
});
