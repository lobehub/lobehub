import { LobeActivatorManifest } from '@lobechat/builtin-tool-activator';
import { AgentBuilderManifest } from '@lobechat/builtin-tool-agent-builder';
import { AgentDocumentsManifest } from '@lobechat/builtin-tool-agent-documents';
import { AgentManagementManifest } from '@lobechat/builtin-tool-agent-management';
import {
  agentSignalFeedbackIntentManifest,
  agentSignalReflectionManifest,
  agentSignalReviewManifest,
  agentSignalSkillManagementManifest,
} from '@lobechat/builtin-tool-agent-signal';
import { BriefManifest } from '@lobechat/builtin-tool-brief';
import { CalculatorManifest } from '@lobechat/builtin-tool-calculator';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { CredsManifest } from '@lobechat/builtin-tool-creds';
import { GroupAgentBuilderManifest } from '@lobechat/builtin-tool-group-agent-builder';
import { GroupManagementManifest } from '@lobechat/builtin-tool-group-management';
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { LobeAgentManifest, resolveLobeAgentManifest } from '@lobechat/builtin-tool-lobe-agent';
import { LobeDeliveryCheckerManifest } from '@lobechat/builtin-tool-lobe-delivery-checker';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { MessageManifest } from '@lobechat/builtin-tool-message';
import { PageAgentManifest } from '@lobechat/builtin-tool-page-agent';
import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import { selfFeedbackIntentManifest } from '@lobechat/builtin-tool-self-iteration';
import { SkillMaintainerManifest } from '@lobechat/builtin-tool-skill-maintainer';
import { SkillStoreManifest } from '@lobechat/builtin-tool-skill-store';
import { resolveSkillsManifest, SkillsManifest } from '@lobechat/builtin-tool-skills';
import { TaskManifest } from '@lobechat/builtin-tool-task';
import { TopicReferenceManifest } from '@lobechat/builtin-tool-topic-reference';
import { UserInteractionManifest } from '@lobechat/builtin-tool-user-interaction';
import { VerifyToolManifest } from '@lobechat/builtin-tool-verify';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { WebOnboardingManifest } from '@lobechat/builtin-tool-web-onboarding';
import { isDesktop, RECOMMENDED_SKILLS, RecommendedSkillType } from '@lobechat/const';
import { type LobeBuiltinTool } from '@lobechat/types';

/**
 * Default tool IDs that will always be added to the tools list.
 * Shared between frontend (createAgentToolsEngine) and server (createServerAgentToolsEngine).
 */
export const defaultToolIds = [
  LobeActivatorManifest.identifier,
  SkillsManifest.identifier,
  SkillStoreManifest.identifier,
  WebBrowsingManifest.identifier,
  KnowledgeBaseManifest.identifier,
  MemoryManifest.identifier,
  LocalSystemManifest.identifier,
  CloudSandboxManifest.identifier,
  TopicReferenceManifest.identifier,
  AgentDocumentsManifest.identifier,
  TaskManifest.identifier,
  LobeAgentManifest.identifier,
];

/**
 * Tool IDs that are always enabled regardless of user selection.
 * These are core system tools that the agent needs to function properly.
 *
 * `lobe-agent` is listed first: its built-in capabilities (plan + todo management,
 * sub-agent dispatch, visual-media fallback) should be available on every agent-mode turn,
 * not gated behind explicit injection. NOTE: these rules only apply in agent mode — chat
 * mode (`enableAgentMode === false`) drops `alwaysOnToolIds` entirely. In manual
 * skill-activate mode the discovery tools in `manualModeExcludeToolIds` are still removed
 * from the defaults before the enable checker runs, so they end up disabled there.
 *
 * This list is also the source for the chat-input Tools popover's read-only "Pinned"
 * section (`builtinToolSelectors.fixedDisplayMetaList`), so users can see what the app
 * keeps active — that selector applies the same manual-mode exclusion to stay truthful.
 */
export const alwaysOnToolIds = [
  LobeAgentManifest.identifier,
  LobeActivatorManifest.identifier,
  SkillsManifest.identifier,
  SkillStoreManifest.identifier,
];

/**
 * Tool IDs to exclude from defaults when in manual skill-activate mode.
 * These are the tool/skill discovery tools that should be disabled when user wants precise control.
 * Other default tools (sandbox, web browsing, etc.) remain available if enabled externally.
 */
export const manualModeExcludeToolIds = [
  LobeActivatorManifest.identifier,
  SkillStoreManifest.identifier,
];

/**
 * Tool IDs allowed when the agent runs in chat mode
 * (`chatConfig.enableAgentMode === false`). Each one still passes through
 * its own runtime gate (e.g. knowledge base requires `hasEnabledKnowledgeBases`,
 * memory requires the global memory setting, web-browsing requires search
 * enabled) — this list is the strict outer whitelist.
 *
 * In chat mode, both the server `createServerAgentToolsEngine` and the
 * frontend `createAgentToolsEngine` build their rules from ONLY these
 * identifiers, drop user plugins / `alwaysOnToolIds` entirely, and disable
 * `allowExplicitActivation` so the activator can't smuggle other tools in.
 */
export const chatModeAllowedToolIds = [
  KnowledgeBaseManifest.identifier,
  MemoryManifest.identifier,
  WebBrowsingManifest.identifier,
];

/**
 * Tool IDs that make up the group supervisor's orchestration toolset:
 * dispatching members (speak / broadcast / delegate / executeAgentTask).
 *
 * These ship only with the builtin `group-supervisor` agent, but a group can
 * run a user's own agent as supervisor (`execGroupAgent` passes the configured
 * supervisor agentId, not the builtin slug). Such a run is verified as the
 * group's supervisor, and the tools engine uses this list — the single source
 * of truth — to both add these tools to the agent-mode candidate set and enable
 * them. Without it the supervisor has no way to dispatch members and degrades
 * to a single-agent monologue.
 *
 * NOTE: `lobe-group-agent-builder` (member CRUD: searchAgent / inviteAgent /
 * createAgent) is deliberately excluded — it has no server runtime registered
 * (`apps/server/.../serverRuntimes`), so advertising it on a server-side
 * supervisor run would throw `Builtin tool "lobe-group-agent-builder" is not
 * implemented` the moment the model called it. Add it back here once a server
 * runtime exists.
 */
export const groupSupervisorToolIds = [GroupManagementManifest.identifier];

/**
 * Tool IDs whose enabled state is decided by runtime / system conditions
 * (e.g. cloud runtime, agent has documents attached, knowledge base configured,
 * desktop gateway available), NOT by the user's plugin selection.
 *
 * The chat-input Tools popover deliberately hides these — even in manual
 * skill-activate mode — so users don't see a toggle that they can't actually
 * affect (the rules in `AgentToolsEngine.createEnableChecker` would force them
 * back on regardless of UI state).
 *
 * If you change this list, keep it in sync with the `rules` map in
 * `src/server/modules/Mecha/AgentToolsEngine/index.ts` and the matching frontend
 * `src/helpers/toolEngineering/index.ts`.
 */
export const runtimeManagedToolIds = [
  CloudSandboxManifest.identifier,
  KnowledgeBaseManifest.identifier,
  LocalSystemManifest.identifier,
  MemoryManifest.identifier,
  RemoteDeviceManifest.identifier,
  LobeAgentManifest.identifier,
  WebBrowsingManifest.identifier,
];

const builtinToolRegistry: LobeBuiltinTool[] = [
  {
    discoverable: false,
    hidden: true,
    identifier: VerifyToolManifest.identifier,
    manifest: VerifyToolManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: LobeActivatorManifest.identifier,
    manifest: LobeActivatorManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: SkillsManifest.identifier,
    manifest: SkillsManifest,
    // Context-aware: prefixes exec-class API descriptions with the run's
    // actual execution environment (cloud sandbox as fallback / offline
    // degradation), so the model never assumes they run on the user's machine.
    resolveManifest: resolveSkillsManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: SkillStoreManifest.identifier,
    manifest: SkillStoreManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: SkillMaintainerManifest.identifier,
    manifest: SkillMaintainerManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: selfFeedbackIntentManifest.identifier,
    manifest: selfFeedbackIntentManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: agentSignalReviewManifest.identifier,
    manifest: agentSignalReviewManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: agentSignalReflectionManifest.identifier,
    manifest: agentSignalReflectionManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: agentSignalFeedbackIntentManifest.identifier,
    manifest: agentSignalFeedbackIntentManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: agentSignalSkillManagementManifest.identifier,
    manifest: agentSignalSkillManagementManifest,
    type: 'builtin',
  },
  {
    discoverable: isDesktop,
    hidden: true,
    identifier: LocalSystemManifest.identifier,
    manifest: LocalSystemManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: MemoryManifest.identifier,
    manifest: MemoryManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: WebBrowsingManifest.identifier,
    manifest: WebBrowsingManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: CloudSandboxManifest.identifier,
    manifest: CloudSandboxManifest,
    type: 'builtin',
  },
  {
    identifier: AgentDocumentsManifest.identifier,
    manifest: AgentDocumentsManifest,
    type: 'builtin',
  },
  {
    identifier: CredsManifest.identifier,
    manifest: CredsManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: KnowledgeBaseManifest.identifier,
    manifest: KnowledgeBaseManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: PageAgentManifest.identifier,
    manifest: PageAgentManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: AgentBuilderManifest.identifier,
    manifest: AgentBuilderManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: GroupAgentBuilderManifest.identifier,
    manifest: GroupAgentBuilderManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: GroupManagementManifest.identifier,
    manifest: GroupManagementManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: AgentManagementManifest.identifier,
    manifest: AgentManagementManifest,
    type: 'builtin',
  },
  {
    identifier: CalculatorManifest.identifier,
    manifest: CalculatorManifest,
    type: 'builtin',
  },
  {
    identifier: MessageManifest.identifier,
    manifest: MessageManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: RemoteDeviceManifest.identifier,
    manifest: RemoteDeviceManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: TopicReferenceManifest.identifier,
    manifest: TopicReferenceManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: WebOnboardingManifest.identifier,
    manifest: WebOnboardingManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: UserInteractionManifest.identifier,
    manifest: UserInteractionManifest,
    type: 'builtin',
  },
  {
    identifier: TaskManifest.identifier,
    manifest: TaskManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: BriefManifest.identifier,
    manifest: BriefManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: LobeAgentManifest.identifier,
    manifest: LobeAgentManifest,
    // Context-aware: hides the `callSubAgent` API inside group / sub-agent runs.
    resolveManifest: resolveLobeAgentManifest,
    type: 'builtin',
  },
  {
    identifier: LobeDeliveryCheckerManifest.identifier,
    manifest: LobeDeliveryCheckerManifest,
    type: 'builtin',
  },
];

/**
 * Hoist each tool's `manifest.meta` identity (title / avatar / description / tags)
 * onto the top level, so context-free consumers (UI lists, discovery, settings,
 * token estimation) read `tool.title` / `tool.avatar` directly instead of reaching
 * into `manifest.meta`. This keeps identity stable and decoupled from `manifest`,
 * which may be produced per-turn by a context-aware `resolveManifest`.
 *
 * Optional chaining is defensive: this runs at module load, and tests routinely
 * mock individual builtin-tool packages (a stubbed manifest may lack `meta`). In
 * production every builtin manifest has a `meta`, so the hoisted fields are real.
 */
export const builtinTools: LobeBuiltinTool[] = builtinToolRegistry.map((tool) => ({
  ...tool,
  avatar: tool.manifest?.meta?.avatar,
  description: tool.manifest?.meta?.description,
  tags: tool.manifest?.meta?.tags,
  title: tool.manifest?.meta?.title,
}));

const recommendedBuiltinIds = new Set(
  RECOMMENDED_SKILLS.filter((s) => s.type === RecommendedSkillType.Builtin).map((s) => s.id),
);

/**
 * Non-hidden builtin tools that are NOT in RECOMMENDED_SKILLS.
 * These tools default to uninstalled and must be explicitly installed by the user from the Skill Store.
 */
export const defaultUninstalledBuiltinTools = builtinTools
  .filter((t) => !t.hidden && !recommendedBuiltinIds.has(t.identifier))
  .map((t) => t.identifier);
