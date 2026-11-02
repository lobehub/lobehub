import type {
  OnDemandActivatedToolBundleMetadata,
  OnDemandContextMetadata,
  OnDemandTraceMetadata,
} from '@lobechat/types';

/**
 * Compose the explicit trace envelope from hash-only context metadata. The raw
 * Agent Prompt is added only here, at the trace boundary, and never to ordinary
 * logs or the compact metadata consumed by the client.
 */
export const buildOnDemandTraceMetadata = ({
  activatedToolBundles = [],
  context,
  rawSystemRole,
}: {
  activatedToolBundles?: readonly OnDemandActivatedToolBundleMetadata[];
  context: OnDemandContextMetadata;
  rawSystemRole: string;
}): OnDemandTraceMetadata => ({
  ...context,
  activatedToolBundles,
  rawSystemRole,
});
