import type { AgentInterventionSanitizedRequest } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { canonicalJson, isCanonicalJsonSafe, providerOptionIds } from '../utils';

describe('agentIntervention utils guards', () => {
  describe('canonicalJson', () => {
    it('rejects a sparse array whose hole is masked by an extra named property', () => {
      // A hole alone already fails the own-key count; the named property keeps
      // both key counts consistent so only the per-index hole check can catch it.
      const holes: string[] = [];
      holes[1] = 'b';
      const sparse = Object.assign(holes, { extra: 'x' });

      expect(() => canonicalJson(sparse)).toThrow('Sparse array is not JSON-safe');
      expect(isCanonicalJsonSafe(sparse)).toBe(false);
    });
  });

  describe('providerOptionIds', () => {
    it('skips field options that carry no id', () => {
      const request = {
        fields: [
          {
            id: 'mode',
            label: 'Mode',
            options: [{ label: 'Unnamed' }, { id: 'safe', label: 'Safe' }],
            type: 'select',
          },
        ],
      } as unknown as AgentInterventionSanitizedRequest;

      expect(providerOptionIds(request)).toEqual(new Set(['safe']));
    });
  });
});
