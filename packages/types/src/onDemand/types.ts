import type { BuiltinToolManifest, ToolManifest } from '../tool';
import type { OnDemandRetrievalMetadata } from './retrieval';

export const ON_DEMAND_PROTOCOL_ID = 'lobe-on-demand-context';
export const ON_DEMAND_PROTOCOL_VERSION = '1';

/**
 * T93's first-turn allocation: 15,500 tokens of usable context plus a
 * 4,500-token reserve, for a 20,000-token request ceiling. Runtime
 * configuration may override these values, but they have one source here.
 */
export const ON_DEMAND_DEFAULT_BUDGET = Object.freeze({
  dynamicTokens: 15_500,
  reserveTokens: 4_500,
  totalTokens: 20_000,
});

export interface OnDemandBudgetConfig {
  /** Usable dynamic-suffix allocation before the reserve is touched. */
  readonly dynamicTokens: number;
  /** Capacity intentionally kept unspent by normal first-turn selection. */
  readonly reserveTokens: number;
  /** Hard ceiling for the complete on-demand request assembly. */
  readonly totalTokens: number;
}

export interface OnDemandTokenEstimatorDescriptor {
  /** Stable estimator identity recorded in trace metadata. */
  readonly id: string;
  readonly model: string;
  readonly provider: string;
}

/**
 * Deterministic estimator shared by candidate construction, retrieval, fixed
 * floors, and the budget planner. Callers may inject a test/fallback estimator,
 * but production uses the same tokenx estimator as the rest of the harness.
 */
export type OnDemandTokenEstimator = (content: string) => number;

/**
 * The bootstrap surface is intentionally closed. Adding an API here is a
 * protocol change: the stable prefix may only expose these native APIs.
 */
export const ON_DEMAND_BOOTSTRAP_ALLOWLIST = {
  'lobe-activator': ['activateTools'],
  'lobe-agent-documents': ['listDocuments', 'readDocument'],
  'lobe-skills': ['activateSkill', 'readReference'],
} as const;

/**
 * Protocol order is semantic and must not depend on object insertion order.
 * Changing this tuple changes the stable-prefix hash.
 */
export const ON_DEMAND_BOOTSTRAP_IDENTIFIERS = [
  'lobe-activator',
  'lobe-agent-documents',
  'lobe-skills',
] as const satisfies readonly (keyof typeof ON_DEMAND_BOOTSTRAP_ALLOWLIST)[];

export type OnDemandBootstrapIdentifier = (typeof ON_DEMAND_BOOTSTRAP_IDENTIFIERS)[number];

export interface OnDemandContentSegment {
  readonly content: string;
  readonly hash: string;
}

export interface OnDemandAgentPromptSegment extends OnDemandContentSegment {
  readonly type: 'agent_prompt';
}

export interface OnDemandProtocolSegment extends OnDemandContentSegment {
  readonly id: typeof ON_DEMAND_PROTOCOL_ID;
  readonly type: 'protocol';
  readonly version: typeof ON_DEMAND_PROTOCOL_VERSION;
}

export interface OnDemandBootstrapTool {
  readonly apiNames: readonly string[];
  readonly identifier: OnDemandBootstrapIdentifier;
  /** A restricted copy of the real builtin manifest, never a synthetic invoke tool. */
  readonly manifest: BuiltinToolManifest;
  readonly manifestHash: string;
}

export interface OnDemandBootstrapToolSegment {
  readonly hash: string;
  readonly identifier: OnDemandBootstrapIdentifier;
  readonly type: 'bootstrap_tool';
}

export type OnDemandStablePrefixSegment =
  OnDemandAgentPromptSegment | OnDemandProtocolSegment | OnDemandBootstrapToolSegment;

/**
 * The complete stable prefix. It deliberately has no slot for history,
 * memories, skills, documents, tool manuals, or mutable environment data.
 */
export interface OnDemandStablePrefix {
  readonly agentPrompt: OnDemandAgentPromptSegment;
  readonly bootstrap: {
    readonly hash: string;
    readonly tools: readonly OnDemandBootstrapTool[];
  };
  readonly hash: string;
  readonly orderedSegments: readonly OnDemandStablePrefixSegment[];
  readonly protocol: OnDemandProtocolSegment;
}

export const ON_DEMAND_DYNAMIC_KINDS = [
  'memory',
  'explicit_constraint',
  'preference',
  'approved_expertise',
  'unapproved_suggestion',
  'skill_card',
  'document_card',
  'tool_card',
  'tool_contract',
  'environment',
  'safety',
  'pending_action',
] as const;

export type OnDemandDynamicKind = (typeof ON_DEMAND_DYNAMIC_KINDS)[number];

export type OnDemandDynamicFloor = 'active_tool_contract' | 'pending_action' | 'safety';

export type OnDemandSourceType =
  'agent' | 'document' | 'memory' | 'runtime' | 'skill' | 'system' | 'tool' | 'user';

export interface OnDemandSource {
  readonly id: string;
  readonly type: OnDemandSourceType;
}

/**
 * Exact source range loaded into the dynamic suffix. `offset` and `length`
 * describe the returned window; `totalLength` describes the source snapshot so
 * a continuation cannot silently move to a different revision.
 */
export interface OnDemandContentRange {
  readonly endLine?: number;
  readonly length: number;
  readonly offset: number;
  readonly startLine?: number;
  readonly totalLength: number;
}

export interface OnDemandProvenance {
  readonly contentHash: string;
  /** Exact pagination window, when the source is a document/read result. */
  readonly range?: OnDemandContentRange;
  /** Loaded reference path, when the source is a skill resource. */
  readonly referencePath?: string;
  readonly source: OnDemandSource;
  readonly sourceVersion?: string;
}

export type OnDemandDegradationReason = 'budget_exceeded' | 'estimator_failed' | 'low_relevance';

export interface OnDemandEntryDegradation {
  readonly originalContentHash: string;
  readonly originalEstimatedTokens: number;
  readonly reason: OnDemandDegradationReason;
  /** Stable locator for reloading the full source; never embeds source text. */
  readonly recoveryRef: string;
  readonly strategy: 'summary_card';
}

/**
 * A dynamic context item. Dynamic items are never allowed to become part of
 * the stable prefix and are only rendered as messages after the current user
 * message.
 */
export interface OnDemandDynamicEntry {
  readonly content: string;
  /**
   * A deterministic summary used only when the full optional item does not fit.
   * The planner never substitutes this for a protected item.
   */
  readonly degradedContent?: string;
  readonly degradedFrom?: OnDemandEntryDegradation;
  readonly estimatedTokens: number;
  readonly floor?: OnDemandDynamicFloor;
  /** Stable identity within one retrieval batch. */
  readonly key: string;
  readonly kind: OnDemandDynamicKind;
  readonly priority: number;
  readonly provenance: OnDemandProvenance;
  /** Source locator exposed to the model when an item is degraded. */
  readonly recoveryRef?: string;
  readonly relevance: number;
  /** Required entries are never dropped by the budget planner. */
  readonly required: boolean;
  readonly source: OnDemandSource;
}

export interface OnDemandFixedTokenFloors {
  /** Full native contracts already active for this step, excluding bootstrap. */
  readonly activeToolContracts?: number;
  readonly bootstrapTools: number;
  readonly currentUserMessage: number;
  readonly protocol: number;
  readonly userPrompt: number;
}

export interface OnDemandBudgetPlanInput {
  readonly entries: readonly OnDemandDynamicEntry[];
  readonly estimator?: OnDemandTokenEstimator;
  readonly estimatorInfo?: OnDemandTokenEstimatorDescriptor;
  readonly fixedTokens: OnDemandFixedTokenFloors;
  /** Dynamic-suffix cap. Defaults to `maxTokens` for legacy callers. */
  readonly maxDynamicTokens?: number;
  readonly maxTokens: number;
  /** Capacity kept unspent unless protected floors need it. */
  readonly reserveTokens?: number;
}

export type OnDemandBudgetDropReason = 'budget_exceeded' | 'empty' | 'estimator_failed';

export interface OnDemandBudgetDrop {
  readonly entry: OnDemandDynamicEntry;
  readonly reason: OnDemandBudgetDropReason;
}

export interface OnDemandBudgetDegradation {
  readonly degradedEntry: OnDemandDynamicEntry;
  readonly entry: OnDemandDynamicEntry;
  readonly reason: OnDemandDegradationReason;
}

export type OnDemandBudgetEntryStatus = 'degraded' | 'included' | 'omitted';

export interface OnDemandBudgetDecisionItem {
  readonly estimatedTokens: number;
  readonly key: string;
  readonly kind: OnDemandDynamicKind;
  readonly originalEstimatedTokens?: number;
  readonly reason?: OnDemandBudgetDropReason | OnDemandDegradationReason;
  readonly status: OnDemandBudgetEntryStatus;
}

export type OnDemandBudgetStatus = 'hard_floor_overflow' | 'within_budget';

export interface OnDemandBudgetDecision {
  readonly availableDynamicTokens: number;
  readonly decisions: readonly OnDemandBudgetDecisionItem[];
  readonly degraded: readonly OnDemandBudgetDegradation[];
  readonly dropped: readonly OnDemandBudgetDrop[];
  readonly estimator: OnDemandTokenEstimatorDescriptor;
  readonly estimatorFailureCount: number;
  readonly fixedBreakdown: OnDemandFixedTokenBreakdown;
  readonly fixedTokens: number;
  readonly hardFloorOverflowTokens: number;
  readonly hardFloorTokens: number;
  readonly hash: string;
  readonly maxDynamicTokens: number;
  readonly maxTokens: number;
  readonly reserveTokens: number;
  readonly reserveUsedTokens: number;
  readonly selected: readonly OnDemandDynamicEntry[];
  readonly selectedOptionalTokens: number;
  readonly status: OnDemandBudgetStatus;
  readonly totalTokens: number;
}

export interface OnDemandFixedTokenBreakdown {
  readonly activeToolContracts: number;
  readonly bootstrapTools: number;
  readonly currentUserMessage: number;
  readonly protocol: number;
  readonly total: number;
  readonly userPrompt: number;
}

export interface OnDemandBudgetDropMetadata {
  readonly key: string;
  readonly reason: OnDemandBudgetDropReason;
}

export interface OnDemandBudgetDegradationMetadata {
  readonly estimatedTokens: number;
  readonly key: string;
  readonly originalContentHash: string;
  readonly originalEstimatedTokens: number;
  readonly reason: OnDemandDegradationReason;
  readonly recoveryRef: string;
}

export interface OnDemandBudgetDecisionMetadata {
  readonly estimatedTokens: number;
  readonly key: string;
  readonly kind: OnDemandDynamicKind;
  readonly originalEstimatedTokens?: number;
  readonly reason?: OnDemandBudgetDropReason | OnDemandDegradationReason;
  readonly status: OnDemandBudgetEntryStatus;
}

/**
 * Trace-safe budget record. It exposes the planner's decision without copying
 * dynamic entry bodies into request metadata.
 */
export interface OnDemandBudgetMetadata {
  readonly availableDynamicTokens: number;
  readonly decisions: readonly OnDemandBudgetDecisionMetadata[];
  readonly degraded: readonly OnDemandBudgetDegradationMetadata[];
  readonly dropped: readonly OnDemandBudgetDropMetadata[];
  readonly estimator: OnDemandTokenEstimatorDescriptor;
  readonly estimatorFailureCount: number;
  readonly fixedBreakdown: OnDemandFixedTokenBreakdown;
  readonly fixedTokens: number;
  readonly hardFloorOverflowTokens: number;
  readonly hardFloorTokens: number;
  readonly hash: string;
  readonly maxDynamicTokens: number;
  readonly maxTokens: number;
  readonly reserveTokens: number;
  readonly reserveUsedTokens: number;
  readonly selectedKeys: readonly string[];
  readonly selectedOptionalTokens: number;
  readonly status: OnDemandBudgetStatus;
  readonly totalTokens: number;
}

export type OnDemandDynamicEntryDropReason =
  OnDemandBudgetDropReason | 'first_turn_body_deferred' | 'low_relevance';

/**
 * Reviewer-facing record of every dynamic candidate considered for a request.
 * `included` describes this first-turn suffix only; deferred bodies remain
 * loadable through their bootstrap capability.
 */
export interface OnDemandDynamicEntryMetadata {
  readonly decision: OnDemandBudgetEntryStatus;
  readonly degradation?: OnDemandBudgetDegradationMetadata;
  /** Normalized reason the candidate was omitted or degraded for this request. */
  readonly degradeReason?: OnDemandDynamicEntryDropReason;
  readonly dropReason?: OnDemandDynamicEntryDropReason;
  readonly estimatedTokens: number;
  readonly included: boolean;
  readonly key: string;
  readonly kind: OnDemandDynamicKind;
  readonly originalEstimatedTokens?: number;
  readonly priority: number;
  readonly provenance: OnDemandProvenance;
  readonly relevance: number;
  readonly required: boolean;
  readonly source: OnDemandSource;
}

export type OnDemandMessageSegmentSource =
  'current_user' | 'dynamic_suffix' | 'history' | 'stable_system';

/**
 * Review-only message segmentation. It deliberately stores hashes rather than
 * message bodies, so a trace can prove what occupied each position without
 * copying memory, skill, or document content into metadata.
 */
export interface OnDemandMessageSegmentMetadata {
  readonly contentHash: string;
  readonly entryKey?: string;
  readonly estimatedTokens: number;
  readonly index: number;
  readonly kind?: OnDemandDynamicKind;
  readonly role: string;
  readonly source: OnDemandMessageSegmentSource;
  readonly sourceId?: string;
  readonly sourceType?: OnDemandSourceType;
}

export interface OnDemandBootstrapToolMetadata {
  readonly apiNames: readonly string[];
  readonly identifier: OnDemandBootstrapIdentifier;
  readonly manifestHash: string;
}

export interface OnDemandActivatedToolBundleMetadata {
  readonly activatedAtStep: number;
  readonly capabilityHash: string;
  readonly capabilityVersion: string;
  readonly identifier: string;
  readonly manifestHash?: string;
  readonly source: string;
}

export interface OnDemandTokenMetadata {
  readonly bootstrapTools: number;
  readonly budgetTotal: number;
  readonly dynamic: number;
  readonly fixed: number;
  readonly max: number;
  readonly messageTotal: number;
  readonly reserve: number;
  readonly reserveUsed: number;
  readonly stableSystem: number;
}

/**
 * Shared metadata contract for client, server, and trace consumers. The raw
 * agent prompt hash is intentionally separate from the stable-prefix hash.
 */
export interface OnDemandContextMetadata {
  readonly bootstrapToolIds: readonly OnDemandBootstrapIdentifier[];
  readonly bootstrapTools: readonly OnDemandBootstrapToolMetadata[];
  readonly budget: OnDemandBudgetMetadata;
  readonly contextMode: 'on-demand';
  readonly currentUserMessageHash?: string;
  readonly dynamicEntries: readonly OnDemandDynamicEntryMetadata[];
  readonly messageSegments: readonly OnDemandMessageSegmentMetadata[];
  readonly protocolVersion: typeof ON_DEMAND_PROTOCOL_VERSION;
  readonly rawSystemRoleHash: string;
  /** Trace-safe memory/expertise retrieval telemetry. */
  readonly retrieval?: OnDemandRetrievalMetadata;
  readonly stablePrefixHash: string;
  readonly tokens: OnDemandTokenMetadata;
}

/**
 * The explicit trace envelope for on-demand requests. `rawSystemRole` is
 * intentionally available only here (never in ordinary logs or the hash-only
 * context metadata) so reviewers can inspect the exact prompt byte sequence.
 */
export interface OnDemandTraceMetadata extends OnDemandContextMetadata {
  readonly activatedToolBundles: readonly OnDemandActivatedToolBundleMetadata[];
  readonly rawSystemRole: string;
}

/**
 * The original current user message is passed through unchanged. Only
 * `appendedMessages` are new, and they are contractually positioned after it.
 */
export interface OnDemandUserMessage {
  readonly content: string;
  readonly id?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly role: 'user';
}

export interface OnDemandAppendedMessageMetadata {
  readonly degradation?: OnDemandBudgetDegradationMetadata;
  readonly entryHash: string;
  readonly entryKey: string;
  readonly estimatedTokens: number;
  readonly kind: OnDemandDynamicKind;
  readonly position: 'after_current_user_message';
  readonly priority: number;
  readonly provenance: OnDemandProvenance;
  readonly required: boolean;
  readonly source: OnDemandSource;
}

export interface OnDemandAppendedMessage {
  readonly content: string;
  readonly id: string;
  readonly metadata: OnDemandAppendedMessageMetadata;
  readonly role: 'assistant' | 'tool' | 'user';
}

export interface OnDemandProtocol {
  readonly appendedMessages: readonly OnDemandAppendedMessage[];
  readonly budget: OnDemandBudgetDecision;
  readonly currentUserMessage: OnDemandUserMessage;
  readonly currentUserMessageHash: string;
  readonly hash: string;
  readonly stablePrefix: OnDemandStablePrefix;
}

export interface OnDemandProtocolBuildInput {
  readonly budget: Omit<OnDemandBudgetPlanInput, 'entries'>;
  readonly currentUserMessage: OnDemandUserMessage;
  readonly entries: readonly OnDemandDynamicEntry[];
  readonly stablePrefix: OnDemandStablePrefix;
}

export type OnDemandCapabilitySource =
  'builtin' | 'composio' | 'lobehub-skill' | 'mcp' | 'plugin' | 'skill';

export type OnDemandCapabilityRuntime =
  'agent-runtime' | 'client' | 'mcp-runtime' | 'plugin-runtime' | 'server';

export type OnDemandExecutionEnvironment = 'client' | 'device' | 'sandbox' | 'server';

export type OnDemandExecutionTransport =
  'builtin-native' | 'device-gateway' | 'http' | 'in-process' | 'mcp';

export interface OnDemandCapabilitySourceRuntime {
  readonly runtime: OnDemandCapabilityRuntime;
  readonly source: OnDemandCapabilitySource;
}

export interface OnDemandCapabilityManual {
  readonly content: string;
  readonly hash: string;
}

export interface OnDemandPermissionPrincipal {
  readonly id: string;
  readonly type: 'agent' | 'shared' | 'user' | 'workspace';
}

export interface OnDemandPermissionGrant {
  readonly principal: OnDemandPermissionPrincipal;
  readonly scopes: readonly string[];
}

export interface OnDemandSharedAuthorization {
  readonly authorizationId: string;
  readonly scopes: readonly string[];
}

export interface OnDemandCapabilityPermissions {
  readonly grants: readonly OnDemandPermissionGrant[];
  readonly hash: string;
  readonly sharedAuthorizations: readonly OnDemandSharedAuthorization[];
}

export interface OnDemandCapabilityExecution {
  readonly environment: OnDemandExecutionEnvironment;
  readonly hash: string;
  readonly transport: OnDemandExecutionTransport;
}

export type OnDemandNativeToolManifest = BuiltinToolManifest | ToolManifest;

/**
 * Everything needed before a native tool is executable. The manifest remains
 * the real native manifest so permissions, intervention, and renderer/UI
 * configuration continue to flow through the existing tool pipeline.
 */
export interface AtomicCapabilityBundle {
  readonly execution: OnDemandCapabilityExecution;
  readonly hash: string;
  readonly identifier: string;
  readonly manifest: OnDemandNativeToolManifest;
  readonly manifestHash: string;
  readonly manual: OnDemandCapabilityManual;
  readonly permissions: OnDemandCapabilityPermissions;
  readonly sourceRuntime: OnDemandCapabilitySourceRuntime;
  readonly version: string;
}

export interface OnDemandCapabilityExpectation {
  readonly hash: string;
  readonly identifier: string;
  readonly version: string;
}

/**
 * A non-executable discovery card. Cards deliberately omit schemas and manuals
 * so listing capabilities does not make them callable or inflate the prompt.
 */
export interface OnDemandToolCard {
  readonly avatar?: string;
  readonly capability: string;
  readonly executionEnvironment: OnDemandExecutionEnvironment;
  readonly hash: string;
  readonly identifier: string;
  readonly name: string;
  readonly source: OnDemandCapabilitySource;
  readonly version: string;
}

/**
 * A compact, non-content document discovery card. It intentionally carries no
 * document body; callers must use `readDocument` with an explicit window.
 */
export interface OnDemandDocumentCard {
  readonly description?: string;
  readonly documentId?: string;
  readonly filename: string;
  readonly id: string;
  readonly sourceType?: string;
  readonly title?: string;
  readonly updatedAt?: string;
}

/**
 * The complete set of capabilities the activator may discover during one
 * operation. Bundles are validated by the producer and re-validated at each
 * activation/resolution boundary.
 */
export interface OnDemandDiscoveryPool {
  readonly bundles: Readonly<Record<string, AtomicCapabilityBundle>>;
  readonly cards: readonly OnDemandToolCard[];
  readonly hash: string;
  readonly version: typeof ON_DEMAND_PROTOCOL_VERSION;
}

export interface OnDemandCapabilityLoadRequest extends OnDemandCapabilityExpectation {}

export type OnDemandCapabilityErrorCode =
  | 'bundle_missing'
  | 'duplicate_conflict'
  | 'execution_environment_missing'
  | 'execution_hash_mismatch'
  | 'execution_missing'
  | 'execution_transport_missing'
  | 'hash_missing'
  | 'hash_mismatch'
  | 'identifier_mismatch'
  | 'identifier_missing'
  | 'manifest_hash_mismatch'
  | 'manifest_invalid'
  | 'manifest_missing'
  | 'manual_hash_mismatch'
  | 'manual_missing'
  | 'not_registered'
  | 'permissions_hash_mismatch'
  | 'permissions_missing'
  | 'runtime_missing'
  | 'source_missing'
  | 'version_mismatch'
  | 'version_missing';

export interface OnDemandCapabilityFailure {
  readonly actual?: string;
  readonly code: OnDemandCapabilityErrorCode;
  readonly expected?: string;
  readonly field: string;
  readonly message: string;
}

export interface OnDemandCapabilityValidationSuccess {
  readonly bundle: AtomicCapabilityBundle;
  readonly hash: string;
  readonly ok: true;
}

export interface OnDemandCapabilityValidationFailure {
  readonly errors: readonly OnDemandCapabilityFailure[];
  readonly ok: false;
}

export type OnDemandCapabilityValidationResult =
  OnDemandCapabilityValidationFailure | OnDemandCapabilityValidationSuccess;

export interface OnDemandBootstrapValidationSuccess {
  readonly manifests: readonly BuiltinToolManifest[];
  readonly ok: true;
}

export interface OnDemandBootstrapFailure {
  readonly actual?: string;
  readonly code:
    | 'bootstrap_api_not_allowed'
    | 'bootstrap_identifier_not_allowed'
    | 'bootstrap_manifest_invalid'
    | 'bootstrap_manifest_missing';
  readonly field: string;
  readonly identifier?: string;
  readonly message: string;
}

export interface OnDemandBootstrapValidationFailure {
  readonly errors: readonly OnDemandBootstrapFailure[];
  readonly ok: false;
}

export type OnDemandBootstrapValidationResult =
  OnDemandBootstrapValidationFailure | OnDemandBootstrapValidationSuccess;

export type OnDemandResolvedEntryClass = 'degradable' | 'protected';
