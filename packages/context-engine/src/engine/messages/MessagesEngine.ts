import debug from 'debug';

import type { OpenAIChatMessage } from '@/types/index';

import { ContextEngine } from '../../pipeline';
import {
  AgentCouncilFlattenProcessor,
  CompressedGroupRoleTransformProcessor,
  GroupMessageFlattenProcessor,
  GroupOrchestrationFilterProcessor,
  GroupRoleTransformProcessor,
  HistoryTruncateProcessor,
  InputTemplateProcessor,
  MessageCleanupProcessor,
  MessageContentProcessor,
  PlaceholderVariablesProcessor,
  ReactionFeedbackProcessor,
  SupervisorRoleRestoreProcessor,
  TaskMessageProcessor,
  TasksFlattenProcessor,
  ToolCallProcessor,
  ToolMessageReorder,
} from '../../processors';
import {
  AgentBuilderContextInjector,
  AgentDocumentBeforeSystemInjector,
  AgentDocumentContextInjector,
  AgentDocumentMessageInjector,
  AgentDocumentSystemAppendInjector,
  AgentDocumentSystemReplaceInjector,
  AgentManagementContextInjector,
  BotPlatformContextInjector,
  DiscordContextProvider,
  EvalContextSystemInjector,
  ForceFinishSummaryInjector,
  GroupAgentBuilderContextInjector,
  GroupContextInjector,
  GTDPlanInjector,
  GTDTodoInjector,
  HistorySummaryProvider,
  KnowledgeInjector,
  PageEditorContextInjector,
  PageSelectionsInjector,
  SelectedSkillInjector,
  SkillContextProvider,
  SystemDateProvider,
  SystemRoleInjector,
  ToolDiscoveryProvider,
  ToolSystemRoleProvider,
  TopicReferenceContextInjector,
  UserMemoryInjector,
} from '../../providers';
import type { ContextProcessor } from '../../types';
import { ToolNameResolver } from '../tools';
import type { MessagesEngineParams, MessagesEngineResult } from './types';

const log = debug('context-engine:MessagesEngine');

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
    const pipeline = this.buildPipeline();
    const result = await pipeline.process({ messages: this.params.messages });

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
      provider,
      systemRole,
      inputTemplate,
      enableHistoryCount,
      historyCount,
      forceFinish,
      historySummary,
      formatHistorySummary,
      knowledge,
      skillsConfig,
      selectedSkills,
      toolDiscoveryConfig,
      toolsConfig,
      capabilities,
      variableGenerators,
      fileContext,
      messages,
      agentBuilderContext,
      botPlatformContext,
      discordContext,
      evalContext,
      agentManagementContext,
      groupAgentBuilderContext,
      agentGroup,
      agentDocuments,
      gtd,
      userMemory,
      initialContext,
      stepContext,
      pageContentContext,
      topicReferences,
      enableSystemDate,
      timezone,
    } = this.params;

    const isAgentBuilderEnabled = !!agentBuilderContext;
    const isAgentManagementEnabled = !!agentManagementContext;

    const isGroupAgentBuilderEnabled = !!groupAgentBuilderContext;
    const isAgentGroupEnabled = agentGroup?.agentMap && Object.keys(agentGroup.agentMap).length > 0;
    const isGroupContextEnabled =
      isAgentGroupEnabled || !!agentGroup?.currentAgentId || !!agentGroup?.members;
    const isUserMemoryEnabled = !!(userMemory?.enabled && userMemory?.memories);
    const hasSelectedSkills = (selectedSkills?.length ?? 0) > 0;

    const hasAgentDocuments = !!agentDocuments && agentDocuments.length > 0;
    // Page editor is enabled if either direct pageContentContext or initialContext.pageEditor is provided
    const isPageEditorEnabled = !!pageContentContext || !!initialContext?.pageEditor;
    // GTD is enabled if gtd.enabled is true and either plan or todos is provided
    const isGTDPlanEnabled = gtd?.enabled && gtd?.plan;
    const isGTDTodoEnabled = gtd?.enabled && gtd?.todos;

    // System date is redundant when web-browsing or memory tools are enabled,
    // as they already include current date in their system prompts
    const toolIds = toolsConfig?.tools || [];
    const hasDateAwareTools =
      toolIds.includes('lobe-web-browsing') || toolIds.includes('lobe-user-memory');
    const isSystemDateEnabled = enableSystemDate !== false && !hasDateAwareTools;
    const currentUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === 'user' && typeof m.content === 'string')?.content as
      | string
      | undefined;

    // Shared config for all agent document injectors
    const agentDocConfig = {
      currentUserMessage,
      documents: agentDocuments,
      enabled: hasAgentDocuments,
    };

    return [
      // =============================================
      // Phase 1: History Truncation
      // MUST run first — all subsequent processors work on truncated messages only
      // =============================================

      new HistoryTruncateProcessor({ enableHistoryCount, historyCount }),

      // =============================================
      // Phase 2: System Message Assembly
      // Each provider appends content to a single system message via BaseSystemRoleProvider
      // =============================================

      // Agent documents → before system (prepend as separate system message)
      new AgentDocumentBeforeSystemInjector(agentDocConfig),
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
      // Skill context (available skills list + activated skill content)
      new SkillContextProvider({
        enabled: !!(skillsConfig?.enabledSkills && skillsConfig.enabledSkills.length > 0),
        enabledSkills: skillsConfig?.enabledSkills,
      }),
      // Tool system role (tool manifests and API definitions)
      new ToolSystemRoleProvider({
        enabled: !!(toolsConfig?.manifests && toolsConfig.manifests.length > 0),
        isCanUseFC: capabilities?.isCanUseFC || (() => true),
        manifests: toolsConfig?.manifests,
        model,
        provider,
      }),
      // History summary (conversation summary from compression)
      new HistorySummaryProvider({ formatHistorySummary, historySummary }),
      // Agent documents → append to system message
      new AgentDocumentSystemAppendInjector(agentDocConfig),
      // Agent documents → replace entire system message (destructive, runs last)
      new AgentDocumentSystemReplaceInjector(agentDocConfig),

      // =============================================
      // Phase 3: Context Injection (before first user message)
      // Providers consolidate into a single injection message via BaseFirstUserContentProvider
      // Order matters: first executed = first in content
      // =============================================

      // User memory
      new UserMemoryInjector({ ...userMemory, enabled: isUserMemoryEnabled }),
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
      // GTD Plan
      new GTDPlanInjector({ enabled: !!isGTDPlanEnabled, plan: gtd?.plan }),
      // Knowledge (agent files + knowledge bases)
      new KnowledgeInjector({
        fileContents: knowledge?.fileContents,
        knowledgeBases: knowledge?.knowledgeBases,
      }),
      // Agent documents → before first user message
      new AgentDocumentContextInjector(agentDocConfig),
      // Tool Discovery (available tools for dynamic activation)
      new ToolDiscoveryProvider({
        availableTools: toolDiscoveryConfig?.availableTools,
        enabled:
          !!toolDiscoveryConfig?.availableTools && toolDiscoveryConfig.availableTools.length > 0,
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

      // =============================================
      // Phase 4: User Message Augmentation
      // Injects context into specific user messages (last user, selected, etc.)
      // =============================================

      // Agent documents → after-first-user, context-end
      new AgentDocumentMessageInjector(agentDocConfig),
      // Selected skills (ephemeral user-selected slash skills for this request)
      new SelectedSkillInjector({ enabled: hasSelectedSkills, selectedSkills }),
      // Page selections (inject user-selected text into each user message)
      new PageSelectionsInjector({ enabled: isPageEditorEnabled }),
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
      // GTD Todo (at end of last user message)
      new GTDTodoInjector({ enabled: !!isGTDTodoEnabled, todos: gtd?.todos }),
      // Topic Reference context (referenced topic summaries to last user message)
      new TopicReferenceContextInjector({
        enabled: !!(topicReferences && topicReferences.length > 0),
        topicReferences,
      }),

      // =============================================
      // Phase 5: Message Transformation
      // Flattens group/task messages, applies templates and variables
      // =============================================

      // Input template processing
      new InputTemplateProcessor({ inputTemplate }),
      // Placeholder variables processing
      new PlaceholderVariablesProcessor({ variableGenerators: variableGenerators || {} }),
      // AgentCouncil message flatten
      new AgentCouncilFlattenProcessor(),
      // Group message flatten
      new GroupMessageFlattenProcessor(),
      // Tasks message flatten
      new TasksFlattenProcessor(),
      // Task message processing
      new TaskMessageProcessor(),
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

      // =============================================
      // Phase 6: Content Processing
      // Multimodal encoding, tool calls, reaction feedback
      // =============================================

      // Reaction feedback
      new ReactionFeedbackProcessor({ enabled: true }),
      // Message content processing (image encoding, multimodal)
      new MessageContentProcessor({
        fileContext: fileContext || { enabled: true, includeFileUrl: true },
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

      // =============================================
      // Phase 7: Cleanup
      // Final reordering, force finish, and message cleanup
      // =============================================

      // Tool message reordering
      new ToolMessageReorder(),
      // Force finish summary (when maxSteps exceeded)
      new ForceFinishSummaryInjector({ enabled: !!forceFinish }),
      // Message cleanup (final step)
      new MessageCleanupProcessor(),
    ];
  }
}
