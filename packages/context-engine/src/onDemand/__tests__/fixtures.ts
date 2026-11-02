import type { AtomicCapabilityBundle, OnDemandDynamicEntry, ToolManifest } from '@lobechat/types';

import { computeAtomicCapabilityBundleHash } from '../bundleValidator';
import { hashContent } from '../canonical';

export const nativeManifest: ToolManifest = {
  api: [
    {
      description: 'Read one fixture record.',
      humanIntervention: 'required',
      name: 'read',
      parameters: {
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
        type: 'object',
      },
      renderDisplayControl: 'alwaysExpand',
    },
  ],
  identifier: 'fixture-native',
  meta: {
    description: 'Native fixture capability',
    title: 'Fixture Native',
  },
  systemRole: 'Use the native fixture tool.',
  type: 'builtin',
  ui: {
    height: 480,
    mode: 'iframe',
    url: 'https://example.com/native-fixture',
  },
};

export const makeCapabilityBundle = (): AtomicCapabilityBundle => {
  const permissions = {
    grants: [
      {
        principal: { id: 'agent-1', type: 'agent' as const },
        scopes: ['fixture:read'],
      },
    ],
    sharedAuthorizations: [
      {
        authorizationId: 'share-1',
        scopes: ['fixture:read'],
      },
    ],
  };
  const execution = {
    environment: 'server' as const,
    transport: 'builtin-native' as const,
  };
  const withoutHash = {
    execution: {
      ...execution,
      hash: hashContent(execution),
    },
    identifier: nativeManifest.identifier,
    manifest: nativeManifest,
    manifestHash: hashContent(nativeManifest),
    manual: {
      content: 'Read the record by id.',
      hash: hashContent({ content: 'Read the record by id.' }),
    },
    permissions: {
      ...permissions,
      hash: hashContent(permissions),
    },
    sourceRuntime: {
      runtime: 'server' as const,
      source: 'builtin' as const,
    },
    version: '1.0.0',
  };

  return {
    ...withoutHash,
    hash: computeAtomicCapabilityBundleHash(withoutHash),
  };
};

export const cloneCapabilityBundle = (): AtomicCapabilityBundle =>
  structuredClone(makeCapabilityBundle());

export const makeDynamicEntry = (
  overrides: Partial<OnDemandDynamicEntry> = {},
): OnDemandDynamicEntry => {
  const key = overrides.key ?? 'entry-1';
  const source = overrides.source ?? { id: key, type: 'memory' as const };

  return {
    content: `Content for ${key}`,
    estimatedTokens: 10,
    key,
    kind: 'memory',
    priority: 10,
    provenance: {
      contentHash: hashContent(`Content for ${key}`),
      source,
    },
    relevance: 0.8,
    required: false,
    source,
    ...overrides,
  };
};
