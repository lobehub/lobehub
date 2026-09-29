import { describe, expect, it } from 'vitest';

import plugin from '../../locales/src/default/plugin';
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
    const intervened = DashboardManifest.api.filter((api) => api.humanIntervention);
    expect(intervened.map((api) => api.name)).toEqual([DashboardApiName.requestPublish]);
    // `required` could be bypassed by auto-run; `always` cannot.
    expect(intervened[0].humanIntervention).toBe('always');
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
