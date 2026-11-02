import debug from 'debug';

import type { OpenAIChatMessage } from '@/types/index';

import { processOnDemandMessages } from '../../onDemand/messages';
import { ContextEngine } from '../../pipeline';
import {
  ActivationResultTrimProcessor,
  AgentCouncilFlattenProcessor,
  CompressedGroupRoleTransformProcessor,
  DisabledToolCallFilter,
  GroupMessageFlattenProcessor,
  GroupOrchestrationFilterProcessor,
  GroupRoleTransformProcessor,
  HistoryTruncateProcessor,
  InputTemplateProcessor,
  MessageCleanupProcessor,
  MessageContentProcessor,
  PlaceholderMessageFilterProcessor,
  PlaceholderVariablesProcessor,
  ReactionFeedbackProcessor,
  SupervisorRoleRestoreProcessor,
  TaskCallbackMessageProcessor,
  TaskMessageProcessor,
  TasksFlattenProcessor,
  ToolCallProcessor,
  ToolMessageReorder,
  VerifyMessageProcessor,
} from '../../processors';
import {
  ActiveTopicDocumentContextInjector,
  AgentBuilderContextInjector,
  AgentManagementContextInjector,
  BotPlatformContextInjector,
  ContextSelectionsInjector,
  DiscordContextProvider,
  EvalContextSystemInjector,
  ForceFinishSummaryInjector,
  GroupAgentBuilderContextInjector,
  GroupContextInjector,
  HistorySummaryProvider,
  KnowledgeInjector,
  LocalSystemToolSnapshotInjector,
  ModelInfoProvider,
  OnboardingActionHintInjector,
  OnboardingContextInjector,
  OnboardingSyntheticStateInjector,
  PageEditorContextInjector,
  PageSelectionsInjector,
  PlanInjector,
  RuntimeAdditionalContextProvider,
  selectActivatedSkills,
  SelectedSkillInjector,
  selectToolPromptManifests,
  SkillContextProvider,
  SystemDateProvider,
  SystemRoleInjector,
  TaskManagerContextInjector,
  TodoInjector,
  ToolSystemRoleProvider,
  TopicReferenceContextInjector,
  UserMemoryInjector,
} from '../../providers';
import { SelectedToolInjector } from '../../providers/SelectedToolInjector';
import type { ContextBuckets, ContextProcessor, PipelineContext } from '../../types';
import { ToolNameResolver } from '../tools';
import type { MessagesEngineParams, MessagesEngineResult } from './types';

const log = debug('context-engine:MessagesEngine');

/**
 * Which recorded bucket each system-prompt provider feeds, and which message
 * container it appends to:
 *   - `system`   = the single system message assembled by BaseSystemRoleProvider
 *   - `injection` = the `systemInjection` user message assembled by
 *     BaseFirstUserContentProvider
 *   - `lastUser` = the last real user message (skipping the injection row),
 *     targeted by BaseLastUserContentProvider injectors
 */
const CONTEXT_BUCKET_RULES: Record<
  string,
  { bucket: keyof ContextBuckets; container: 'injection' | 'lastUser' | 'system' }
> = {
  // assistant profile: agent persona + date + model info + user memory +
  // the agent's environment/resource context (agent management, builder,
  // onboarding) — everything the model sees as its identity & surroundings.
  SystemRoleInjector: { bucket: 'systemRole', container: 'system' },
  SystemDateProvider: { bucket: 'systemRole', container: 'system' },
  ModelInfoProvider: { bucket: 'systemRole', container: 'system' },
  UserMemoryInjector: { bucket: 'systemRole', container: 'injection' },
  AgentBuilderContextInjector: { bucket: 'systemRole', container: 'injection' },
  AgentManagementContextInjector: { bucket: 'systemRole', container: 'injection' },
  GroupAgentBuilderContextInjector: { bucket: 'systemRole', container: 'injection' },
  OnboardingContextInjector: { bucket: 'systemRole', container: 'injection' },
  // skills: teaching blocks + schemas + skill index + discovery + knowledge
  SkillContextProvider: { bucket: 'tools', container: 'system' },
  ToolSystemRoleProvider: { bucket: 'tools', container: 'system' },
  KnowledgeInjector: { bucket: 'tools', container: 'injection' },
  // history summary
  HistorySummaryProvider: { bucket: 'historySummary', container: 'system' },
  // chats: conversation-environment injectors that ride the rows
  GroupContextInjector: { bucket: 'chats', container: 'injection' },
  DiscordContextProvider: { bucket: 'chats', container: 'injection' },
  PlanInjector: { bucket: 'chats', container: 'injection' },
  ActiveTopicDocumentContextInjector: { bucket: 'chats', container: 'lastUser' },
  SelectedSkillInjector: { bucket: 'chats', container: 'lastUser' },
  SelectedToolInjector: { bucket: 'chats', container: 'lastUser' },
  ContextSelectionsInjector: { bucket: 'chats', container: 'lastUser' },
  PageSelectionsInjector: { bucket: 'chats', container: 'lastUser' },
  LocalSystemToolSnapshotInjector: { bucket: 'chats', container: 'lastUser' },
  PageEditorContextInjector: { bucket: 'chats', container: 'lastUser' },
  TaskManagerContextInjector: { bucket: 'chats', container: 'lastUser' },
  TodoInjector: { bucket: 'chats', container: 'lastUser' },
  TopicReferenceContextInjector: { bucket: 'chats', container: 'lastUser' },
};

/**
 * Extract the plain text of a message container for diffing.
 */
const containerText = (
  messages: PipelineContext['messages'],
  container: 'injection' | 'lastUser' | 'system',
) => {
  const msg =
    container === 'system'
      ? messages.find((m) => m.role === 'system')
      : container === 'injection'
        ? messages.find((m) => m.meta?.systemInjection === true)
        : [...messages]
            .reverse()
            .find((m) => m.role === 'user' && m.meta?.systemInjection !== true);
  if (!msg) return '';
  const content = msg.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === 'text')
      .map((part) => part.text ?? '')
      .join('');
  }
  return '';
};

/**
 * Wrap a provider so the text it appends to its container is recorded into
 * `metadata.contextBuckets` — the send side then counts those texts with the
 * tokenx estimator, matching exactly what the LLM will receive.
 */
const withContextBucket = (
  processor: ContextProcessor,
  rule: { bucket: keyof ContextBuckets; container: 'injection' | 'lastUser' | 'system' },
): ContextProcessor => ({
  name: processor.name,
  process: async (context) => {
    const before = containerText(context.messages, rule.container);
    const next = await processor.process(context);
    const after = containerText(next.messages, rule.container);
    if (after === before) return next;
    const added = after.startsWith(before) ? after.slice(before.length) : '';
    if (!added) return next;
    const metadata = next.metadata;
    const buckets = (metadata.contextBuckets ??= {
      chats: '',
      historySummary: '',
      systemRole: '',
      tools: '',
    });
    buckets[rule.bucket] += added;
    return next;
  },
});

/**
 * MessagesEngine - High-level message processing engine
 *
 * This is a convenience wrapper around ContextEngine that provides
 * a pre-configured pipeline for common message processing scenarios.
 * It can be used by both frontend and backend through dependency injection.
 *
 * @example
 * ```typescript
 * const engine = new MessagesEngine({
 *   messages,
 *   model: 'gpt-4',
 *   provider: 'openai',
 *   systemRole: 'You are a helpful assistant',
 *   capabilities: {
 *     isCanUseFC: (m, p) => true,
 *     isCanUseVision: (m, p) => true,
 *   },
 * });
 *
 * const result = await engine.process();
 * console.log(result.messages);
 * ```
 */
export class MessagesEngine {
  private params: MessagesEngineParams;
  private toolNameResolver: ToolNameResolver;

  constructor(params: MessagesEngineParams) {
    this.params = params;
    this.toolNameResolver = new ToolNameResolver();
  }

  /**
   * Process messages and return OpenAI-compatible format
   */
  async process(): Promise<MessagesEngineResult> {
    if (this.params.contextMode === 'on-demand') {
      return processOnDemandMessages(this.params, {
        genToolCallingName: this.toolNameResolver.generate.bind(this.toolNameResolver),
      });
    }

    const pipeline = this.buildPipeline();
    const result = await pipeline.process({ messages: this.params.messages });

    // Combine the chats bucket: conversation rows captured after truncation
    // plus per-request injectors that ride the user messages.
    if (result.metadata.contextBuckets) {
      result.metadata.contextBuckets.chats =
        (result.metadata.contextChatsBase ?? '') + result.metadata.contextBuckets.chats;
    }

    return {
      messages: result.messages as OpenAIChatMessage[],
      metadata: result.metadata,
      stats: result.stats,
    };
  }

  /**
   * Process messages and return only the messages array
   * This is a convenience method for simpler use cases
   */
  async processMessages(): Promise<OpenAIChatMessage[]> {
    const result = await this.process();
    return result.messages;
  }

  /**
   * Build the processing pipeline based on configuration
   */
  private buildPipeline(): ContextEngine {
    const processors = this.buildProcessors();
    log(`Built pipeline with ${processors.length} processors`);
    return new ContextEngine({ pipeline: processors });
  }

  /**
   * Build the list of processors based on configuration
   */
  private buildProcessors(): ContextProcessor[] {
    const {
      model,
      modelDisplayName,
      modelKnowledgeCutoff,
      provider,
      systemRole,
      inputTemplate,
      enableAgentMode,
      promptMode,
      enableHistoryCount,
      historyCount,
      forceFinish,
      historySummary,
      formatHistorySummary,
      knowledge,
      skillsConfig,
      selectedSkills,
      selectedTools,
      toolsConfig,
      capabilities,
      variableGenerators,
      fileContext,
      agentBuilderContext,
      botPlatformContext,
      discordContext,
      evalContext,
      onboardingContext,
      agentManagementContext,
      groupAgentBuilderContext,
      additionalContexts,
      agentGroup,
      planTodo,
      userMemory,
      initialContext,
      stepContext,
      pageContentContext,
      topicReferences,
      enableSystemDate,
      timezone,
    } = this.params;

    const isAgentBuilderEnabled = !!agentBuilderContext;

    const isGroupAgentBuilderEnabled = !!groupAgentBuilderContext;
    const isAgentGroupEnabled = agentGroup?.agentMap && Object.keys(agentGroup.agentMap).length > 0;
    const isGroupContextEnabled =
      isAgentGroupEnabled || !!agentGroup?.currentAgentId || !!agentGroup?.members;
    const isUserMemoryEnabled = !!(userMemory?.enabled && userMemory?.memories);
    const hasSelectedSkills = (selectedSkills?.length ?? 0) > 0;
    const hasSelectedTools = (selectedTools?.length ?? 0) > 0;

    // Chat mode (`enableAgentMode === false`) suppresses agentic-only injectors:
    // skill discovery (<available_skills>) and the agent-management context
    // (<current_agent> + <available_agents>).
    // Anything else — system role, knowledge bases, memory, web-browsing tool
    // prompts — remains untouched.
    const isAgentMode = enableAgentMode !== false;
    const isAgentManagementEnabled = !!agentManagementContext && isAgentMode;
    // Page editor is enabled if either direct pageContentContext or initialContext.pageEditor is provided
    const isPageEditorEnabled = !!pageContentContext || !!initialContext?.pageEditor;
    const hasActiveTopicDocument = !!initialContext?.activeTopicDocument;
    // Runtime message state is authoritative, including an empty clear tombstone.
    const isPlanEnabled = planTodo?.enabled && planTodo?.plan;
    const effectiveTodos =
      stepContext?.todos !== undefined
        ? stepContext.todos
        : planTodo?.enabled
          ? planTodo.todos
          : undefined;
    const isTodoEnabled = effectiveTodos !== undefined;

    // System date is redundant when web-browsing or memory tools are enabled,
    // as they already include current date in their system prompts
    const toolIds = toolsConfig?.tools || [];
    const hasDateAwareTools =
      toolIds.includes('lobe-web-browsing') || toolIds.includes('lobe-user-memory');
    const isSystemDateEnabled = enableSystemDate !== false && !hasDateAwareTools;
    // Mirror the injection gates of SkillContextProvider / ToolSystemRoleProvider
    // (enable flags + FC support + the shared select predicates) so
    // ActivationResultTrimProcessor only trims activation tool results whose full
    // documentation is confirmed to be injected into the system prompt for this
    // request.
    const canUseFC = capabilities?.isCanUseFC || (() => true);
    const injectedActivatedSkills =
      isAgentMode && (skillsConfig?.enabledSkills?.length ?? 0) > 0
        ? selectActivatedSkills(skillsConfig?.enabledSkills)
        : [];
    const injectedToolManifests =
      (toolsConfig?.manifests?.length ?? 0) > 0 && !!canUseFC(model, provider)
        ? selectToolPromptManifests(toolsConfig?.manifests)
        : [];

    const processors = [
      // =============================================
      // Phase 0: Placeholder Residue Filtering
      // Drop failed/abandoned assistant placeholders ("..." rows) BEFORE
      // truncation so residue never consumes history slots and never lands
      // at the payload tail (Claude 4.6+ rejects trailing assistant turns)
      // =============================================

      new PlaceholderMessageFilterProcessor(),

      // =============================================
      // Phase 1: History Truncation
      // MUST run first — all subsequent processors work on truncated messages only
      // =============================================

      new HistoryTruncateProcessor({ enableHistoryCount, historyCount }),

      // =============================================
      // Phase 2: System Message Assembly
      // Each provider appends content to a single system message via BaseSystemRoleProvider
      // =============================================

      // Agent's system role (creates the initial system message)
      new SystemRoleInjector({ systemRole }),
      // Eval context (appends envPrompt)
      new EvalContextSystemInjector({ enabled: !!evalContext?.envPrompt, evalContext }),
      // Bot platform context (formatting instructions for non-Markdown platforms)
      new BotPlatformContextInjector({
        context: botPlatformContext,
        enabled: !!botPlatformContext,
      }),
      // System date
      new SystemDateProvider({ enabled: isSystemDateEnabled, timezone }),
      // Model info (name / id / knowledge cutoff)
      new ModelInfoProvider({
        displayName: modelDisplayName,
        knowledgeCutoff: modelKnowledgeCutoff,
        modelId: model,
        nativeMediaCapabilities: {
          audio: capabilities?.isCanUseAudio?.(model, provider),
          video: capabilities?.isCanUseVideo?.(model, provider),
          vision: capabilities?.isCanUseVision?.(model, provider),
        },
      }),
      // Skill context (available skills list + activated skill content).
      // Disabled in chat mode — pairs with the tools-engine gate so the LLM
      // sees neither the manifests nor the discovery prompt.
      new SkillContextProvider({
        promptMode,
        enabled:
          isAgentMode && !!(skillsConfig?.enabledSkills && skillsConfig.enabledSkills.length > 0),
        enabledSkills: skillsConfig?.enabledSkills,
      }),
      // Tool system role (tool manifests and API definitions)
      new ToolSystemRoleProvider({
        enabled: !!(toolsConfig?.manifests && toolsConfig.manifests.length > 0),
        isCanUseFC: capabilities?.isCanUseFC || (() => true),
        manifests: toolsConfig?.manifests,
        model,
        promptMode,
        provider,
      }),
      // History summary (conversation summary from compression)
      new HistorySummaryProvider({ formatHistorySummary, historySummary }),
      // =============================================
      // Phase 3: Context Injection (before first user message)
      // Providers consolidate into a single injection message via BaseFirstUserContentProvider
      // Order matters: first executed = first in content
      // =============================================

      // User memory
      new UserMemoryInjector({ ...userMemory, enabled: isUserMemoryEnabled, promptMode }),
      // Group context (agent identity and group info for multi-agent chat)
      new GroupContextInjector({
        currentAgentId: agentGroup?.currentAgentId,
        currentAgentName: agentGroup?.currentAgentName,
        currentAgentRole: agentGroup?.currentAgentRole,
        enabled: isGroupContextEnabled,
        groupTitle: agentGroup?.groupTitle,
        members: agentGroup?.members,
        systemPrompt: agentGroup?.systemPrompt,
      }),
      // Discord context (channel/guild info)
      new DiscordContextProvider({ context: discordContext, enabled: !!discordContext }),
      // Plan (high-level plan document)
      new PlanInjector({ enabled: !!isPlanEnabled, plan: planTodo?.plan }),
      // Knowledge (agent files + knowledge bases)
      new KnowledgeInjector({
        fileContents: knowledge?.fileContents,
        knowledgeBases: knowledge?.knowledgeBases,
      }),
      // Agent Builder context (current agent config/meta for editing)
      new AgentBuilderContextInjector({
        enabled: isAgentBuilderEnabled,
        agentContext: agentBuilderContext,
      }),
      // Agent Management context (available models and plugins)
      new AgentManagementContextInjector({
        enabled: isAgentManagementEnabled,
        context: agentManagementContext,
      }),
      // Group Agent Builder context (current group config/members for editing)
      new GroupAgentBuilderContextInjector({
        enabled: isGroupAgentBuilderEnabled,
        groupContext: groupAgentBuilderContext,
      }),
      // Onboarding context (phase guidance + document contents — stable, cacheable)
      new OnboardingContextInjector({
        enabled: !!onboardingContext?.phaseGuidance,
        onboardingContext,
      }),

      // =============================================
      // Phase 4: User Message Augmentation
      // Injects context into specific user messages (last user, selected, etc.)
      // =============================================

      // Active topic document → last user message, for continuing document work outside page scope
      new ActiveTopicDocumentContextInjector({
        activeTopicDocument: initialContext?.activeTopicDocument,
        enabled: hasActiveTopicDocument && !isPageEditorEnabled,
      }),
      // Selected skills (ephemeral user-selected slash skills for this request)
      new SelectedSkillInjector({ enabled: hasSelectedSkills, selectedSkills }),
      // Selected tools (ephemeral user-selected @tool for this request)
      new SelectedToolInjector({ enabled: hasSelectedTools, selectedTools }),
      // Generic user-attached selections from chat/code/text contexts.
      new ContextSelectionsInjector({ enabled: true }),
      // Legacy page editor selections.
      new PageSelectionsInjector({ enabled: isPageEditorEnabled }),
      // Local-system file snapshots (replay send-time @file reads as real tool results)
      new LocalSystemToolSnapshotInjector({ enabled: true }),
      // Page Editor context (inject current page content to last user message)
      new PageEditorContextInjector({
        enabled: isPageEditorEnabled,
        pageContentContext:
          pageContentContext ??
          (initialContext?.pageEditor
            ? {
                markdown: initialContext.pageEditor.markdown,
                metadata: {
                  charCount: initialContext.pageEditor.metadata.charCount,
                  lineCount: initialContext.pageEditor.metadata.lineCount,
                  title: initialContext.pageEditor.metadata.title,
                },
                xml: stepContext?.stepPageEditor?.xml || initialContext.pageEditor.xml,
              }
            : undefined),
      }),
      // Task Manager page context (inject current tasks list/detail to last user message)
      new TaskManagerContextInjector({
        contextPrompt: initialContext?.taskManager?.contextPrompt,
        enabled: !!initialContext?.taskManager?.contextPrompt,
      }),
      // Todo list (at end of last user message)
      new TodoInjector({ enabled: isTodoEnabled, todos: effectiveTodos }),
      // Topic Reference context (referenced topic summaries to last user message)
      new TopicReferenceContextInjector({
        enabled: !!(topicReferences && topicReferences.length > 0),
        topicReferences,
      }),

      // =============================================
      // Phase 4.5: Virtual Tail Guidance
      // Inject high-churn runtime guidance at the tail to preserve stable prefix caching
      // =============================================

      // Onboarding synthetic state (fake getOnboardingState tool call pair to drive action loop)
      new OnboardingSyntheticStateInjector({
        enabled: !!onboardingContext?.phaseGuidance,
        onboardingContext,
      }),
      // Onboarding action hints (phase-specific tool call reminders)
      new OnboardingActionHintInjector({
        enabled: !!onboardingContext?.phaseGuidance,
        onboardingContext,
      }),
      new RuntimeAdditionalContextProvider({ additionalContexts }),

      // =============================================
      // Phase 5: Message Transformation
      // Flattens group/task messages, applies templates and variables
      // =============================================

      // Input template processing
      new InputTemplateProcessor({ inputTemplate }),
      // AgentCouncil message flatten
      new AgentCouncilFlattenProcessor(),
      // Group message flatten
      new GroupMessageFlattenProcessor(),
      // Tasks message flatten
      new TasksFlattenProcessor(),
      // Task message processing
      new TaskMessageProcessor(),
      // Second placeholder pass: the flatten steps above can expand "..."
      // residue hidden inside group/council/tasks children (invisible to the
      // Phase 0 pass, which only sees top-level messages), and
      // TaskMessageProcessor converts flattened `task` rows into assistant
      // messages — so this pass must run AFTER that conversion to catch
      // task-shaped residue too.
      new PlaceholderMessageFilterProcessor(),
      // Verify (delivery-checker) cards: drop empty UI-only ones; surface
      // auto-repair failure feedback as a user turn for the repair run
      new VerifyMessageProcessor(),
      // Task-callback cards: surface a finished task's handoff as a user turn
      // so the creator agent reads it and continues
      new TaskCallbackMessageProcessor(),
      // Supervisor role restore
      new SupervisorRoleRestoreProcessor(),
      // Compressed group role transform
      new CompressedGroupRoleTransformProcessor(),
      // Group orchestration filter (must run BEFORE GroupRoleTransformProcessor)
      ...(isAgentGroupEnabled && agentGroup.agentMap && agentGroup.currentAgentId
        ? [
            new GroupOrchestrationFilterProcessor({
              agentMap: Object.fromEntries(
                Object.entries(agentGroup.agentMap).map(([id, info]) => [id, { role: info.role }]),
              ),
              currentAgentId: agentGroup.currentAgentId,
              enabled: agentGroup.currentAgentRole !== 'supervisor',
            }),
          ]
        : []),
      // Group role transform (must run BEFORE ToolCallProcessor)
      ...(isAgentGroupEnabled && agentGroup.currentAgentId
        ? [
            new GroupRoleTransformProcessor({
              agentMap: agentGroup.agentMap!,
              currentAgentId: agentGroup.currentAgentId,
            }),
          ]
        : []),
      // Dynamic-activation result trimming — replaces activateTools /
      // activateSkill tool-result documents that are ALSO injected into the
      // system prompt (by ToolSystemRoleProvider / SkillContextProvider above)
      // with a short confirmation, so each activated document reaches the LLM
      // payload exactly once. MUST run AFTER the flatten steps (grouped /
      // compressed tool rows are only hoisted back to `role: 'tool'` with
      // plugin/pluginState there) and BEFORE ToolCallProcessor.
      new ActivationResultTrimProcessor({
        injectedManifests: injectedToolManifests,
        injectedSkills: injectedActivatedSkills,
      }),
      // Placeholder variables processing — MUST run AFTER all flatten / role
      // transform steps. AssistantGroup / Supervisor messages keep their real
      // content (including any `{{...}}` placeholders inside tool results)
      // nested under `children[].tools[].result.content`. The flatten processors
      // hoist that nested content into top-level `role: 'tool'` messages.
      // PlaceholderVariablesProcessor only walks `message.content`, so it MUST
      // run after the hoist or it would silently miss every placeholder buried
      // inside an assistantGroup. (Regression discovered while wiring lobehub
      // skill identity placeholders — see .)
      new PlaceholderVariablesProcessor({ variableGenerators: variableGenerators || {} }),

      // =============================================
      // Phase 6: Content Processing
      // Multimodal encoding, tool calls, reaction feedback
      // =============================================

      // Reaction feedback
      new ReactionFeedbackProcessor({ enabled: true }),
      // Message content processing (image encoding, multimodal)
      new MessageContentProcessor({
        fileContext: fileContext || { enabled: true, includeFileUrl: true },
        isCanUseAudio: capabilities?.isCanUseAudio || (() => false),
        isCanUseVideo: capabilities?.isCanUseVideo || (() => false),
        isCanUseVision: capabilities?.isCanUseVision || (() => true),
        model,
        provider,
      }),
      // Tool call processing
      new ToolCallProcessor({
        genToolCallingName: this.toolNameResolver.generate.bind(this.toolNameResolver),
        isCanUseFC: capabilities?.isCanUseFC || (() => true),
        model,
        provider,
      }),
      // Disabled historical tool calls (for scope-specific tool removal)
      new DisabledToolCallFilter({
        disabledToolIdentifiers: toolsConfig?.disabledToolIdentifiers,
      }),

      // =============================================
      // Phase 7: Cleanup
      // Final reordering, force finish, and message cleanup
      // =============================================

      // Tool message reordering
      new ToolMessageReorder(),
      // Force finish summary (when maxSteps exceeded)
      new ForceFinishSummaryInjector({ enabled: !!forceFinish }),
      new MessageCleanupProcessor(),
    ];

    // Wrap system-prompt providers so the text they append lands in
    // `metadata.contextBuckets` for exact send-side token counting. The
    // truncation step additionally snapshots the surviving conversation rows
    // (history + current input) as the base of the `chats` bucket — captured
    // here, before any injection creates the systemInjection row.
    return processors.map((processor) => {
      if (processor.name === 'HistoryTruncateProcessor') {
        return {
          name: processor.name,
          process: async (context) => {
            const next = await processor.process(context);
            if (!next.metadata.contextChatsBase) {
              next.metadata.contextChatsBase = next.messages
                .map((m) => containerText([m], 'lastUser'))
                .join('');
            }
            return next;
          },
        };
      }
      const rule = CONTEXT_BUCKET_RULES[processor.name];
      return rule ? withContextBucket(processor, rule) : processor;
    });
  }
}
