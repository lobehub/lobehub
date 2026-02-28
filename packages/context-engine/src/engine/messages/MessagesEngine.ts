import debug from 'debug';

import type { OpenAIChatMessage } from '@/types/index';

import { ContextEngine } from '../../pipeline';
import {
  AgentCouncilFlattenProcessor,
  CompressedGroupRoleTransformProcessor,
  GroupMessageFlattenProcessor,
  GroupOrchestrationFilterProcessor,
  GroupRoleTransformProcessor,
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
  EvalContextSystemInjector,
  ForceFinishSummaryInjector,
  AgentManagementContextInjector,
  GTDPlanInjector,
  GTDTodoInjector,
  GroupAgentBuilderContextInjector,
  GroupContextInjector,
  HistorySummaryProvider,
  KnowledgeInjector,
  PageEditorContextInjector,
  PageSelectionsInjector,
  SkillContextProvider,
  SystemDateProvider,
  SystemRoleInjector,
  ToolDiscoveryProvider,
  ToolSystemRoleProvider,
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
      forceFinish,
      historySummary,
      formatHistorySummary,
      knowledge,
      skillsConfig,
      toolDiscoveryConfig,
      toolsConfig,
      capabilities,
      variableGenerators,
      fileContext,
      agentBuilderContext,
      evalContext,
      agentManagementContext,
      groupAgentBuilderContext,
      agentGroup,
      gtd,
      userMemory,
      initialContext,
      stepContext,
      pageContentContext,
      enableSystemDate,
    } = this.params;

    const isAgentBuilderEnabled = !!agentBuilderContext;
    const isAgentManagementEnabled = !!agentManagementContext;

    const isGroupAgentBuilderEnabled = !!groupAgentBuilderContext;
    const isAgentGroupEnabled = agentGroup?.agentMap && Object.keys(agentGroup.agentMap).length > 0;
    const isGroupContextEnabled =
      isAgentGroupEnabled || !!agentGroup?.currentAgentId || !!agentGroup?.members;
    const isUserMemoryEnabled = userMemory?.enabled && userMemory?.memories;
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

    return [
      // =============================================
      // Phase 1: System Role Injection
      // =============================================

      // 1. System role injection (agent's system role)
      new SystemRoleInjector({ systemRole }),

      // 2. Eval context injection (appends envPrompt to system message)
      new EvalContextSystemInjector({ enabled: !!evalContext?.envPrompt, evalContext }),

      // 3. System date injection (appends current date to system message)
      new SystemDateProvider({ enabled: isSystemDateEnabled }),

      // =============================================
      // Phase 2: First User Message Context Injection
      // These providers inject content before the first user message
      // Order matters: first executed = first in content
      // =============================================

      // 4. User memory injection (conditionally added, injected first)
      ...(isUserMemoryEnabled ? [new UserMemoryInjector(userMemory)] : []),

      // 5. Group context injection (agent identity and group info for multi-agent chat)
      new GroupContextInjector({
        currentAgentId: agentGroup?.currentAgentId,
        currentAgentName: agentGroup?.currentAgentName,
        currentAgentRole: agentGroup?.currentAgentRole,
        enabled: isGroupContextEnabled,
        groupTitle: agentGroup?.groupTitle,
        members: agentGroup?.members,
        systemPrompt: agentGroup?.systemPrompt,
      }),

      // 6. GTD Plan injection (conditionally added, after user memory, before knowledge)
      ...(isGTDPlanEnabled ? [new GTDPlanInjector({ enabled: true, plan: gtd.plan })] : []),

      // 7. Knowledge injection (full content for agent files + metadata for knowledge bases)
      new KnowledgeInjector({
        fileContents: knowledge?.fileContents,
        knowledgeBases: knowledge?.knowledgeBases,
      }),

      // 8. Tool Discovery context injection (available tools for dynamic activation)
      ...(toolDiscoveryConfig?.availableTools && toolDiscoveryConfig.availableTools.length > 0
        ? [new ToolDiscoveryProvider({ availableTools: toolDiscoveryConfig.availableTools })]
        : []),

      // =============================================
      // Phase 3: Additional System Context
      // =============================================

      // 9. Agent Builder context injection (current agent config/meta for editing)
      new AgentBuilderContextInjector({
        enabled: isAgentBuilderEnabled,
        agentContext: agentBuilderContext,
      }),

      // 7. Agent Management context injection (available models and plugins for agent creation)
      new AgentManagementContextInjector({
        enabled: isAgentManagementEnabled,
        context: agentManagementContext,
      }),

      // 8. Group Agent Builder context injection (current group config/members for editing)
      new GroupAgentBuilderContextInjector({
        enabled: isGroupAgentBuilderEnabled,
        groupContext: groupAgentBuilderContext,
      }),

      // 11. Skill context injection (conditionally added)
      ...(skillsConfig?.enabledSkills && skillsConfig.enabledSkills.length > 0
        ? [
            new SkillContextProvider({
              enabledSkills: skillsConfig.enabledSkills,
            }),
          ]
        : []),

      // 12. Tool system role injection (conditionally added)
      ...(toolsConfig?.manifests && toolsConfig.manifests.length > 0
        ? [
          new ToolSystemRoleProvider({
            isCanUseFC: capabilities?.isCanUseFC || (() => true),
            manifests: toolsConfig.manifests,
            model,
            provider,
          }),
        ]
        : []),

      // 13. History summary injection
      new HistorySummaryProvider({
        formatHistorySummary,
        historySummary,
      }),

      // 14. Page Selections injection (inject user-selected text into each user message that has them)
      new PageSelectionsInjector({ enabled: isPageEditorEnabled }),

      // 15. Page Editor context injection (inject current page content to last user message)
      new PageEditorContextInjector({
        enabled: isPageEditorEnabled,
        // Use direct pageContentContext if provided (server-side), otherwise build from initialContext + stepContext (frontend)
        pageContentContext: pageContentContext
          ? pageContentContext
          : initialContext?.pageEditor
            ? {
              markdown: initialContext.pageEditor.markdown,
              metadata: {
                charCount: initialContext.pageEditor.metadata.charCount,
                lineCount: initialContext.pageEditor.metadata.lineCount,
                title: initialContext.pageEditor.metadata.title,
              },
              // Use latest XML from stepContext if available, otherwise fallback to initial XML
              xml: stepContext?.stepPageEditor?.xml || initialContext.pageEditor.xml,
            }
            : undefined,
      }),

      // 16. GTD Todo injection (conditionally added, at end of last user message)
      ...(isGTDTodoEnabled ? [new GTDTodoInjector({ enabled: true, todos: gtd.todos })] : []),

      // =============================================
      // Phase 4: Message Transformation
      // =============================================

      // 17. Input template processing
      new InputTemplateProcessor({ inputTemplate }),

      // 18. Placeholder variables processing
      new PlaceholderVariablesProcessor({
        variableGenerators: variableGenerators || {},
      }),

      // 19. AgentCouncil message flatten (convert role=agentCouncil to standard assistant + tool messages)
      new AgentCouncilFlattenProcessor(),

      // 20. Group message flatten (convert role=assistantGroup to standard assistant + tool messages)
      new GroupMessageFlattenProcessor(),

      // 21. Tasks message flatten (convert role=tasks to individual task messages)
      new TasksFlattenProcessor(),

      // 22. Task message processing (convert role=task to assistant with instruction + content)
      new TaskMessageProcessor(),

      // 23. Supervisor role restore (convert role=supervisor back to role=assistant for model)
      new SupervisorRoleRestoreProcessor(),

      // 24. Compressed group role transform (convert role=compressedGroup to role=user for model)
      new CompressedGroupRoleTransformProcessor(),

      // 25. Group orchestration filter (remove supervisor's orchestration messages like broadcast/speak)
      // This must be BEFORE GroupRoleTransformProcessor so we filter based on original agentId/tools
      ...(isAgentGroupEnabled && agentGroup.agentMap && agentGroup.currentAgentId
        ? [
          new GroupOrchestrationFilterProcessor({
            agentMap: Object.fromEntries(
              Object.entries(agentGroup.agentMap).map(([id, info]) => [id, { role: info.role }]),
            ),
            currentAgentId: agentGroup.currentAgentId,
            // Only enabled when current agent is NOT supervisor (supervisor needs to see orchestration history)
            enabled: agentGroup.currentAgentRole !== 'supervisor',
          }),
        ]
        : []),

      // 26. Group role transform (convert other agents' messages to user role with speaker tags)
      // This must be BEFORE ToolCallProcessor so other agents' tool messages are converted first
      ...(isAgentGroupEnabled && agentGroup.currentAgentId
        ? [
          new GroupRoleTransformProcessor({
            agentMap: agentGroup.agentMap!,
            currentAgentId: agentGroup.currentAgentId,
          }),
        ]
        : []),

      // =============================================
      // Phase 5: Content Processing
      // =============================================

      // 27. Reaction feedback injection (append user reaction feedback to assistant messages)
      new ReactionFeedbackProcessor({ enabled: true }),

      // 28. Message content processing (image encoding, etc.)
      new MessageContentProcessor({
        fileContext: fileContext || { enabled: true, includeFileUrl: true },
        isCanUseVideo: capabilities?.isCanUseVideo || (() => false),
        isCanUseVision: capabilities?.isCanUseVision || (() => true),
        model,
        provider,
      }),

      // 29. Tool call processing
      new ToolCallProcessor({
        genToolCallingName: this.toolNameResolver.generate.bind(this.toolNameResolver),
        isCanUseFC: capabilities?.isCanUseFC || (() => true),
        model,
        provider,
      }),

      // 30. Tool message reordering
      new ToolMessageReorder(),

      // 31. Force finish summary injection (when maxSteps exceeded, inject summary prompt)
      new ForceFinishSummaryInjector({ enabled: !!forceFinish }),

      // 32. Message cleanup (final step, keep only necessary fields)
      new MessageCleanupProcessor(),
    ];
  }
}
