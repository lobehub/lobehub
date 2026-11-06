import { evalToolManifestSchema } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { mergeCaseEnvironment } from './caseEnvironment';

const contract = (identifier: string, description = 'Original read') => ({
  identifier,
  meta: { title: identifier },
  api: [{ name: 'read', description, parameters: { type: 'object' } }],
});

describe('frozen environment tool contracts', () => {
  it('a case overrides one contract without dropping the other inherited tools', () => {
    const shared = { toolManifests: { notion: contract('notion'), gmail: contract('gmail') } };
    const own = { toolManifests: { notion: contract('notion', 'Case-specific read') } };
    expect(mergeCaseEnvironment(shared, own)?.toolManifests).toEqual({
      notion: own.toolManifests.notion,
      gmail: shared.toolManifests.gmail,
    });
  });

  it('rejects ambiguous routing names and execution configuration in a model-facing contract', () => {
    expect(evalToolManifestSchema.safeParse(contract('notion____other')).success).toBe(false);
    expect(
      evalToolManifestSchema.safeParse({
        ...contract('notion'),
        api: [{ ...contract('notion').api[0], name: 'read____other' }],
      }).success,
    ).toBe(false);
    expect(
      evalToolManifestSchema.safeParse({
        ...contract('notion'),
        mcpParams: { url: 'https://mock.invalid' },
      }).success,
    ).toBe(false);
    expect(evalToolManifestSchema.safeParse(contract('notion')).success).toBe(true);
  });
});
