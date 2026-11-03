import { DASHBOARD_DRY_RUN_AUDIT, DashboardManifest } from '@lobechat/builtin-tool-dashboard';
import { describe, expect, it } from 'vitest';

import { dynamicInterventionAudits } from './dynamicInterventionAudits';

describe('dynamicInterventionAudits', () => {
  it('registers every dynamic audit a builtin manifest references', () => {
    const referenced = DashboardManifest.api
      .map((api) => api.humanIntervention)
      .filter((config): config is { dynamic: { type: string } } =>
        Boolean(config && typeof config === 'object' && 'dynamic' in config),
      )
      .map((config) => config.dynamic.type);

    expect(referenced).toContain(DASHBOARD_DRY_RUN_AUDIT);
    for (const type of referenced) expect(dynamicInterventionAudits).toHaveProperty(type);
  });

  it('asks the user for a dashboard dry run when the host cannot read the version', async () => {
    // A missing resolver would fall back to the manifest's `default: never`.
    await expect(
      dynamicInterventionAudits[DASHBOARD_DRY_RUN_AUDIT]({ versionId: 'v1', widgetId: 'w1' }),
    ).resolves.toBe(true);
  });
});
