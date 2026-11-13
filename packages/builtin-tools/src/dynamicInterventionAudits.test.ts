import {
  CLOUD_SANDBOX_DELETE_AUDIT,
  CloudSandboxManifest,
} from '@lobechat/builtin-tool-cloud-sandbox';
import { DASHBOARD_DRY_RUN_AUDIT, DashboardManifest } from '@lobechat/builtin-tool-dashboard';
import { describe, expect, it } from 'vitest';

import { dynamicInterventionAudits } from './dynamicInterventionAudits';

describe('dynamicInterventionAudits', () => {
  it('registers every dynamic audit a builtin manifest references', () => {
    const referenced = [...DashboardManifest.api, ...CloudSandboxManifest.api]
      .map((api) => api.humanIntervention)
      .filter((config): config is { dynamic: { type: string } } =>
        Boolean(config && typeof config === 'object' && 'dynamic' in config),
      )
      .map((config) => config.dynamic.type);

    expect(referenced).toContain(DASHBOARD_DRY_RUN_AUDIT);
    expect(referenced).toContain(CLOUD_SANDBOX_DELETE_AUDIT);
    for (const type of referenced) expect(dynamicInterventionAudits).toHaveProperty(type);
  });

  it('asks the user for a dashboard dry run when the host cannot read the version', async () => {
    // A missing resolver would fall back to the manifest's `default: never`.
    await expect(
      dynamicInterventionAudits[DASHBOARD_DRY_RUN_AUDIT]({ versionId: 'v1', widgetId: 'w1' }),
    ).resolves.toBe(true);
  });

  it('asks before a sandbox delete unless every path is claimed regenerable', async () => {
    const audit = dynamicInterventionAudits[CLOUD_SANDBOX_DELETE_AUDIT];
    // `always`: auto-run mode cannot skip a permanent delete of irreplaceable files.
    expect(
      CloudSandboxManifest.api.find((api) => api.name === 'deleteFiles')?.humanIntervention,
    ).toEqual({
      dynamic: { default: 'never', policy: 'always', type: CLOUD_SANDBOX_DELETE_AUDIT },
    });

    await expect(audit({ paths: ['/workspace/notes.md'] })).resolves.toBe(true);
    await expect(audit({ paths: ['/workspace/a'], regenerableOnly: false })).resolves.toBe(true);
    // A truthy non-boolean is not the flag the storage service enforces.
    await expect(audit({ paths: ['/workspace/a'], regenerableOnly: 'true' })).resolves.toBe(true);
    await expect(audit({})).resolves.toBe(true);
    await expect(
      audit({ paths: ['/workspace/app/node_modules'], regenerableOnly: true }),
    ).resolves.toBe(false);
  });
});
