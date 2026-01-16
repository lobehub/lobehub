import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:GroupOrchestrationFilterProcessor');

/**
 * Default orchestration tool identifier
 */
const DEFAULT_ORCHESTRATION_IDENTIFIER = 'lobe-group-management';

/**
 * Default orchestration api names that should be filtered
 */
const DEFAULT_ORCHESTRATION_API_NAMES = ['broadcast', 'speak', 'executeTask', 'executeTasks'];

/**
 * Agent info for identifying supervisor
 */
export interface OrchestrationAgentInfo {
  role: 'supervisor' | 'participant';
}

/**
 * Tool info structure
 */
interface ToolInfo {
  apiName?: string;
  identifier?: string;
}

/**
 * Configuration for GroupOrchestrationFilterProcessor
 */
export interface GroupOrchestrationFilterConfig {
  /**
   * Mapping from agentId to agent info
   * Used to identify supervisor messages
   */
  agentMap?: Record<string, OrchestrationAgentInfo>;
  /**
   * The current agent ID that is responding
   * If the current agent is supervisor, filtering will be skipped
   * (Supervisor needs to see its own orchestration history)
   */
  currentAgentId?: string;
  /**
   * Whether to enable filtering
   * @default true
   */
  enabled?: boolean;
  /**
   * Api names of orchestration tools to filter
   * @default ['broadcast', 'speak', 'executeTask', 'executeTasks']
   */
  orchestrationApiNames?: string[];
  /**
   * Tool identifiers that are considered orchestration tools
   * @default ['lobe-group-management']
   */
  orchestrationToolIdentifiers?: string[];
}

/**
 * Group Orchestration Filter Processor
 *
 * Filters out Supervisor's orchestration messages (broadcast, speak, executeTask, etc.)
 * from the context to reduce noise for participant agents.
 *
 * These messages are coordination metadata that participant agents don't need to see.
 * Filtering them reduces context window usage and prevents model confusion.
 *
 * Filtering rules:
 * - Supervisor assistant + orchestration tool_use: REMOVE
 * - Supervisor tool_result for orchestration tools: REMOVE
 * - Supervisor assistant without tools: KEEP (may contain meaningful summaries)
 * - Supervisor assistant + non-orchestration tools: KEEP (e.g., search)
 *
 * @example
 * ```typescript
 * const processor = new GroupOrchestrationFilterProcessor({
 *   agentMap: {
 *     'supervisor-id': { role: 'supervisor' },
 *     'agent-1': { role: 'participant' },
 *   },
 * });
 * ```
 */
export class GroupOrchestrationFilterProcessor extends BaseProcessor {
  readonly name = 'GroupOrchestrationFilterProcessor';

  private config: GroupOrchestrationFilterConfig;
  private orchestrationIdentifiers: Set<string>;
  private orchestrationApiNames: Set<string>;

  constructor(config: GroupOrchestrationFilterConfig = {}, options: ProcessorOptions = {}) {
    super(options);
    this.config = config;
    this.orchestrationIdentifiers = new Set(
      config.orchestrationToolIdentifiers || [DEFAULT_ORCHESTRATION_IDENTIFIER],
    );
    this.orchestrationApiNames = new Set(
      config.orchestrationApiNames || DEFAULT_ORCHESTRATION_API_NAMES,
    );
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    // Skip if disabled or no agentMap provided
    if (this.config.enabled === false || !this.config.agentMap) {
      log('Processor disabled or no agentMap provided, skipping');
      return this.markAsExecuted(clonedContext);
    }

    // Skip if current agent is supervisor (supervisor needs to see its orchestration history)
    if (this.isCurrentAgentSupervisor()) {
      log('Current agent is supervisor, skipping orchestration filter');
      return this.markAsExecuted(clonedContext);
    }

    let filteredCount = 0;
    let assistantFiltered = 0;
    let toolFiltered = 0;

    const filteredMessages = clonedContext.messages.filter((msg: Message) => {
      // Only filter supervisor messages
      if (!this.isSupervisorMessage(msg)) {
        return true;
      }

      // Check assistant messages with tools
      if (msg.role === 'assistant' && msg.tools && msg.tools.length > 0) {
        const hasOrchestrationTool = msg.tools.some((tool: ToolInfo) =>
          this.isOrchestrationTool(tool),
        );

        if (hasOrchestrationTool) {
          filteredCount++;
          assistantFiltered++;
          log(`Filtering supervisor orchestration assistant message: ${msg.id}`);
          return false;
        }
      }

      // Check tool result messages
      if (msg.role === 'tool' && msg.plugin && this.isOrchestrationTool(msg.plugin)) {
        filteredCount++;
        toolFiltered++;
        log(`Filtering supervisor orchestration tool result: ${msg.id}`);
        return false;
      }

      // Keep other supervisor messages (pure text, non-orchestration tools)
      return true;
    });

    clonedContext.messages = filteredMessages;

    // Update metadata
    clonedContext.metadata.orchestrationFilterProcessed = {
      assistantFiltered,
      filteredCount,
      toolFiltered,
    };

    log(
      `Orchestration filter completed: ${filteredCount} messages filtered (${assistantFiltered} assistant, ${toolFiltered} tool)`,
    );

    return this.markAsExecuted(clonedContext);
  }

  /**
   * Check if the current agent is a supervisor
   * Supervisor doesn't need orchestration messages filtered (they need to see their history)
   */
  private isCurrentAgentSupervisor(): boolean {
    if (!this.config.currentAgentId || !this.config.agentMap) {
      return false;
    }

    const currentAgentInfo = this.config.agentMap[this.config.currentAgentId];
    return currentAgentInfo?.role === 'supervisor';
  }

  /**
   * Check if a message is from a supervisor agent
   */
  private isSupervisorMessage(msg: Message): boolean {
    if (!msg.agentId || !this.config.agentMap) {
      return false;
    }

    const agentInfo = this.config.agentMap[msg.agentId];
    return agentInfo?.role === 'supervisor';
  }

  /**
   * Check if a tool is an orchestration tool that should be filtered
   */
  private isOrchestrationTool(tool: ToolInfo): boolean {
    if (!tool) return false;

    const identifier = tool.identifier || '';
    const apiName = tool.apiName || '';

    return this.orchestrationIdentifiers.has(identifier) && this.orchestrationApiNames.has(apiName);
  }
}
