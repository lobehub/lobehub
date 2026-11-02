import type {
  BuiltinToolManifest,
  OnDemandAppendedMessage,
  OnDemandBootstrapTool,
  OnDemandBootstrapValidationResult,
  OnDemandProtocol,
  OnDemandProtocolBuildInput,
  OnDemandStablePrefix,
  OnDemandStablePrefixSegment,
} from '@lobechat/types';
import {
  BuiltinToolManifestSchema,
  isOnDemandBootstrapApiAllowed,
  ON_DEMAND_BOOTSTRAP_ALLOWLIST,
  ON_DEMAND_BOOTSTRAP_IDENTIFIERS,
  ON_DEMAND_PROTOCOL_ID,
  ON_DEMAND_PROTOCOL_VERSION,
} from '@lobechat/types';

import { ON_DEMAND_BOOTSTRAP_MANIFESTS } from './bootstrapManifests';
import { planOnDemandBudget } from './budgetPlanner';
import { hashContent } from './canonical';
import { renderOnDemandContextMessageContent } from './rendering';

export const ON_DEMAND_PROTOCOL_CONTENT = [
  '<on_demand_context_protocol version="1">',
  'The agent prompt is preserved exactly as supplied.',
  'Only the bootstrap tools listed here are available before activation.',
  'Load capabilities, skills, documents, memories, and manuals on demand.',
  'A capability is executable only after its complete atomic bundle is loaded and validated.',
  'Dynamic context is appended after the current user message and never rewrites system or user messages.',
  'Do not infer missing schemas, permissions, execution details, versions, or hashes.',
  '</on_demand_context_protocol>',
].join('\n');

const bootstrapFailure = (
  code:
    | 'bootstrap_api_not_allowed'
    | 'bootstrap_identifier_not_allowed'
    | 'bootstrap_manifest_invalid'
    | 'bootstrap_manifest_missing',
  field: string,
  message: string,
  values: { actual?: string; identifier?: string } = {},
) => ({ code, field, message, ...values });

/**
 * Validates that the bootstrap list is exactly the real, closed set. Missing or
 * extra tools/APIs fail closed rather than silently widening the prefix.
 */
export const validateOnDemandBootstrap = (
  manifests: readonly BuiltinToolManifest[],
): OnDemandBootstrapValidationResult => {
  const errors = [];
  const expectedIdentifiers = ON_DEMAND_BOOTSTRAP_IDENTIFIERS;

  if (manifests.length !== expectedIdentifiers.length) {
    errors.push(
      bootstrapFailure(
        'bootstrap_manifest_missing',
        'bootstrap',
        `Expected ${expectedIdentifiers.length} bootstrap manifests, received ${manifests.length}.`,
        { actual: String(manifests.length) },
      ),
    );
  }

  const seenIdentifiers = new Set<string>();
  for (const [index, manifest] of manifests.entries()) {
    const identifier = manifest?.identifier;
    if (!identifier) {
      errors.push(
        bootstrapFailure(
          'bootstrap_manifest_missing',
          `bootstrap.${index}.identifier`,
          'Bootstrap manifest identifier is missing.',
        ),
      );
      continue;
    }

    if (!(expectedIdentifiers as readonly string[]).includes(identifier)) {
      errors.push(
        bootstrapFailure(
          'bootstrap_identifier_not_allowed',
          `bootstrap.${index}.identifier`,
          `Bootstrap identifier is not allowed: ${identifier}`,
          { actual: identifier, identifier },
        ),
      );
      continue;
    }

    if (seenIdentifiers.has(identifier)) {
      errors.push(
        bootstrapFailure(
          'bootstrap_manifest_invalid',
          `bootstrap.${index}.identifier`,
          `Duplicate bootstrap identifier: ${identifier}`,
          { actual: identifier, identifier },
        ),
      );
      continue;
    }
    seenIdentifiers.add(identifier);

    const parsed = BuiltinToolManifestSchema.safeParse(manifest);
    if (!parsed.success) {
      errors.push(
        bootstrapFailure(
          'bootstrap_manifest_invalid',
          `bootstrap.${index}`,
          `Bootstrap manifest is invalid: ${parsed.error.message}`,
          { identifier },
        ),
      );
      continue;
    }

    const allowedApiNames: readonly string[] =
      ON_DEMAND_BOOTSTRAP_ALLOWLIST[identifier as keyof typeof ON_DEMAND_BOOTSTRAP_ALLOWLIST];
    const apiNames = manifest.api.map((api) => api.name);

    if (
      apiNames.length !== allowedApiNames.length ||
      new Set(apiNames).size !== apiNames.length ||
      apiNames.some((apiName) => !isOnDemandBootstrapApiAllowed(identifier, apiName))
    ) {
      errors.push(
        bootstrapFailure(
          'bootstrap_api_not_allowed',
          `bootstrap.${index}.api`,
          `Bootstrap APIs differ from the closed allowlist for ${identifier}.`,
          { actual: apiNames.join(','), identifier },
        ),
      );
    }
  }

  for (const identifier of expectedIdentifiers) {
    if (!seenIdentifiers.has(identifier)) {
      errors.push(
        bootstrapFailure(
          'bootstrap_manifest_missing',
          'bootstrap',
          `Missing bootstrap manifest: ${identifier}`,
          { identifier },
        ),
      );
    }
  }

  return errors.length > 0 ? { errors: Object.freeze(errors), ok: false } : { manifests, ok: true };
};

const buildBootstrapTools = (
  manifests: readonly BuiltinToolManifest[],
): readonly OnDemandBootstrapTool[] => {
  const byIdentifier = new Map(manifests.map((manifest) => [manifest.identifier, manifest]));

  return Object.freeze(
    ON_DEMAND_BOOTSTRAP_IDENTIFIERS.map((identifier) => {
      const manifest = byIdentifier.get(identifier);
      if (!manifest) {
        throw new Error(`Missing validated bootstrap manifest: ${identifier}`);
      }
      const apiNames = ON_DEMAND_BOOTSTRAP_ALLOWLIST[identifier];

      return Object.freeze({
        apiNames: Object.freeze([...apiNames]),
        identifier,
        manifest,
        manifestHash: hashContent(manifest),
      });
    }),
  );
};

/**
 * Checks the closed shape and hashes of an already-built stable prefix. This is
 * used before dynamic context is composed so callers cannot smuggle dynamic
 * content into the stable prefix.
 */
export const validateOnDemandStablePrefix = (
  prefix: OnDemandStablePrefix,
):
  | { readonly errors: readonly string[]; readonly ok: false; readonly prefix?: never }
  | { readonly errors?: never; readonly ok: true; readonly prefix: OnDemandStablePrefix } => {
  const errors: string[] = [];
  const allowedKeys = ['agentPrompt', 'bootstrap', 'hash', 'orderedSegments', 'protocol'];
  const actualKeys = Object.keys(prefix).sort();
  if (
    actualKeys.length !== allowedKeys.length ||
    actualKeys.some((key, index) => key !== allowedKeys[index])
  ) {
    errors.push(`Stable prefix has unsupported fields: ${actualKeys.join(',')}`);
  }

  if (
    prefix.agentPrompt?.type !== 'agent_prompt' ||
    prefix.agentPrompt.hash !== hashContent(prefix.agentPrompt.content)
  ) {
    errors.push('Agent prompt segment is invalid or its hash drifted.');
  }

  if (
    prefix.protocol?.type !== 'protocol' ||
    prefix.protocol.id !== ON_DEMAND_PROTOCOL_ID ||
    prefix.protocol.version !== ON_DEMAND_PROTOCOL_VERSION ||
    prefix.protocol.content !== ON_DEMAND_PROTOCOL_CONTENT ||
    prefix.protocol.hash !== hashContent(ON_DEMAND_PROTOCOL_CONTENT)
  ) {
    errors.push('Fixed protocol segment is invalid or its hash drifted.');
  }

  const bootstrapValidation = validateOnDemandBootstrap(
    prefix.bootstrap?.tools.map((tool) => tool.manifest) ?? [],
  );
  if (!bootstrapValidation.ok) {
    errors.push(...bootstrapValidation.errors.map((error) => error.message));
  } else {
    const expectedTools = buildBootstrapTools(bootstrapValidation.manifests);
    if (hashContent(prefix.bootstrap.tools) !== hashContent(expectedTools)) {
      errors.push('Bootstrap tools differ from the closed allowlist.');
    }
    if (prefix.bootstrap.hash !== hashContent(prefix.bootstrap.tools)) {
      errors.push('Bootstrap hash drifted.');
    }

    const expectedSegments: readonly OnDemandStablePrefixSegment[] = [
      prefix.agentPrompt,
      prefix.protocol,
      ...expectedTools.map((tool) => ({
        hash: tool.manifestHash,
        identifier: tool.identifier,
        type: 'bootstrap_tool' as const,
      })),
    ];
    if (hashContent(prefix.orderedSegments) !== hashContent(expectedSegments)) {
      errors.push('Stable prefix segment order or content drifted.');
    }
  }

  const { hash, ...prefixContent } = prefix;
  if (hash !== hashContent(prefixContent)) {
    errors.push('Stable prefix hash drifted.');
  }

  return errors.length > 0 ? { errors: Object.freeze(errors), ok: false } : { ok: true, prefix };
};

export const buildOnDemandStablePrefix = (input: {
  agentPrompt: string;
  bootstrapManifests?: readonly BuiltinToolManifest[];
}): OnDemandStablePrefix => {
  const bootstrapManifests = input.bootstrapManifests ?? ON_DEMAND_BOOTSTRAP_MANIFESTS;
  const bootstrapValidation = validateOnDemandBootstrap(bootstrapManifests);
  if (!bootstrapValidation.ok) {
    throw new Error(bootstrapValidation.errors.map((error) => error.message).join('\n'));
  }

  const agentPrompt = Object.freeze({
    content: input.agentPrompt,
    hash: hashContent(input.agentPrompt),
    type: 'agent_prompt' as const,
  });
  const protocol = Object.freeze({
    content: ON_DEMAND_PROTOCOL_CONTENT,
    hash: hashContent(ON_DEMAND_PROTOCOL_CONTENT),
    id: ON_DEMAND_PROTOCOL_ID,
    type: 'protocol' as const,
    version: ON_DEMAND_PROTOCOL_VERSION,
  });
  const bootstrapTools = buildBootstrapTools(bootstrapManifests);
  const bootstrap = Object.freeze({
    hash: hashContent(bootstrapTools),
    tools: bootstrapTools,
  });
  const orderedSegments: readonly OnDemandStablePrefixSegment[] = Object.freeze([
    agentPrompt,
    protocol,
    ...bootstrapTools.map((tool) =>
      Object.freeze({
        hash: tool.manifestHash,
        identifier: tool.identifier,
        type: 'bootstrap_tool' as const,
      }),
    ),
  ]);
  const prefixWithoutHash = {
    agentPrompt,
    bootstrap,
    orderedSegments,
    protocol,
  };

  return Object.freeze({
    ...prefixWithoutHash,
    hash: hashContent(prefixWithoutHash),
  });
};

const buildAppendedMessages = (
  entries: OnDemandProtocolBuildInput['entries'],
): readonly OnDemandAppendedMessage[] =>
  Object.freeze(
    entries.map((entry) => {
      const entryHash = hashContent(entry);
      const content = renderOnDemandContextMessageContent(entry);

      return Object.freeze({
        content,
        id: `on-demand-${entryHash}`,
        metadata: Object.freeze({
          ...(entry.degradedFrom && {
            degradation: Object.freeze({
              estimatedTokens: entry.estimatedTokens,
              key: entry.key,
              originalContentHash: entry.degradedFrom.originalContentHash,
              originalEstimatedTokens: entry.degradedFrom.originalEstimatedTokens,
              reason: entry.degradedFrom.reason,
              recoveryRef: entry.degradedFrom.recoveryRef,
            }),
          }),
          entryHash,
          entryKey: entry.key,
          estimatedTokens: entry.estimatedTokens,
          kind: entry.kind,
          position: 'after_current_user_message' as const,
          priority: entry.priority,
          provenance: entry.provenance,
          required: entry.required,
          source: entry.source,
        }),
        role: 'user' as const,
      });
    }),
  );

/**
 * Builds only the dynamic suffix. `currentUserMessage` is passed through
 * unchanged and appended messages carry an explicit post-current-message
 * position; no system or first-user message is accepted or produced.
 */
export const buildOnDemandProtocol = (input: OnDemandProtocolBuildInput): OnDemandProtocol => {
  if (input.currentUserMessage.role !== 'user') {
    throw new Error('On-demand protocol requires the current user message.');
  }

  const prefixValidation = validateOnDemandStablePrefix(input.stablePrefix);
  if (!prefixValidation.ok) {
    throw new Error(prefixValidation.errors.join('\n'));
  }

  const budget = planOnDemandBudget({
    entries: input.entries,
    estimator: input.budget.estimator,
    estimatorInfo: input.budget.estimatorInfo,
    fixedTokens: input.budget.fixedTokens,
    maxDynamicTokens: input.budget.maxDynamicTokens,
    maxTokens: input.budget.maxTokens,
    reserveTokens: input.budget.reserveTokens,
  });
  const appendedMessages = buildAppendedMessages(budget.selected);
  const protocolWithoutHash = {
    appendedMessages,
    budget,
    currentUserMessage: input.currentUserMessage,
    currentUserMessageHash: hashContent(input.currentUserMessage),
    stablePrefix: input.stablePrefix,
  };

  return Object.freeze({
    ...protocolWithoutHash,
    hash: hashContent(protocolWithoutHash),
  });
};
