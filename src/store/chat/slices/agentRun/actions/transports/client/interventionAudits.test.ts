import { CLOUD_SANDBOX_DELETE_AUDIT } from '@lobechat/builtin-tool-cloud-sandbox';
import { dynamicInterventionAudits } from '@lobechat/builtin-tools/dynamicInterventionAudits';
import { describe, expect, it, vi } from 'vitest';

import { clientInterventionAudits } from './interventionAudits';

vi.mock('@/services/dashboard', () => ({ dashboardService: {} }));
vi.mock('@/services/electron/localFileService', () => ({ localFileService: {} }));
vi.mock('@/store/user/store', () => ({ getUserStoreState: () => ({ settings: {} }) }));

describe('clientInterventionAudits', () => {
  // A dynamic audit missing here falls back to the manifest's default on
  // client-driven runs, which for a permanent delete means running unasked.
  it('registers every audit the server registers', () => {
    for (const type of Object.keys(dynamicInterventionAudits)) {
      expect(clientInterventionAudits).toHaveProperty(type);
    }
  });

  it('asks before a sandbox delete unless it is regenerable only', async () => {
    const audit = clientInterventionAudits[CLOUD_SANDBOX_DELETE_AUDIT];

    await expect(audit({ paths: ['/workspace/notes.md'] })).resolves.toBe(true);
    await expect(
      audit({ paths: ['/workspace/a/node_modules'], regenerableOnly: true }),
    ).resolves.toBe(false);
  });
});
