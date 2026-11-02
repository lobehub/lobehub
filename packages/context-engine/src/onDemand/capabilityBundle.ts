import type {
  AtomicCapabilityBundle,
  OnDemandCapabilityExecution,
  OnDemandCapabilityPermissions,
  OnDemandCapabilitySourceRuntime,
} from '@lobechat/types';

import type { LobeToolManifest } from '../engine/tools/types';
import {
  computeAtomicCapabilityBundleHash,
  validateAtomicCapabilityBundle,
} from './bundleValidator';
import { hashContent } from './canonical';

export interface BuildAtomicCapabilityBundleInput {
  execution: Omit<OnDemandCapabilityExecution, 'hash'>;
  identifier: string;
  manifest: LobeToolManifest;
  manual?: string;
  permissions: Omit<OnDemandCapabilityPermissions, 'hash'>;
  sourceRuntime: OnDemandCapabilitySourceRuntime;
  version?: string;
}

/**
 * Builds the complete, untruncated manual that travels with a capability.
 * Every API schema is serialized from the native manifest; callers cannot
 * substitute a summary for the executable contract.
 */
export const renderAtomicCapabilityManual = (manifest: LobeToolManifest): string => {
  const systemRole = manifest.systemRole?.trim() ? manifest.systemRole : '';
  const apiSchemas = JSON.stringify(manifest.api, null, 2);

  return [
    `<tool_manual identifier="${manifest.identifier}">`,
    '<system_role>',
    systemRole,
    '</system_role>',
    '<api_schemas>',
    apiSchemas,
    '</api_schemas>',
    '</tool_manual>',
  ].join('\n');
};

const deriveVersion = (content: {
  executionHash: string;
  identifier: string;
  manifestHash: string;
  manualHash: string;
  permissionsHash: string;
}) => `atomic-${hashContent(content).replace(/^md5:/, '').slice(0, 16)}`;

/**
 * Materializes an atomic native capability. The builder fails closed if the
 * resulting bundle cannot pass the same validator used by the loader.
 */
export const buildAtomicCapabilityBundle = (
  input: BuildAtomicCapabilityBundleInput,
): AtomicCapabilityBundle => {
  const manualContent = input.manual ?? renderAtomicCapabilityManual(input.manifest);
  const manifestHash = hashContent(input.manifest);
  const manualHash = hashContent({ content: manualContent });
  const permissionsHash = hashContent({
    grants: input.permissions.grants,
    sharedAuthorizations: input.permissions.sharedAuthorizations,
  });
  const executionHash = hashContent({
    environment: input.execution.environment,
    transport: input.execution.transport,
  });
  const version =
    input.version ??
    deriveVersion({
      executionHash,
      identifier: input.identifier,
      manifestHash,
      manualHash,
      permissionsHash,
    });
  const withoutHash = {
    execution: { ...input.execution, hash: executionHash },
    identifier: input.identifier,
    manifest: input.manifest,
    manifestHash,
    manual: { content: manualContent, hash: manualHash },
    permissions: { ...input.permissions, hash: permissionsHash },
    sourceRuntime: input.sourceRuntime,
    version,
  };
  const bundle: AtomicCapabilityBundle = {
    ...withoutHash,
    hash: computeAtomicCapabilityBundleHash(withoutHash),
  };
  const validation = validateAtomicCapabilityBundle(bundle);

  if (!validation.ok) {
    throw new Error(
      `Invalid atomic capability bundle ${input.identifier}: ${validation.errors
        .map((error) => `${error.code}:${error.field}`)
        .join(', ')}`,
    );
  }

  return bundle;
};
