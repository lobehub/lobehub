import { buildGoalOverviewPrompt } from '@lobechat/prompts';
import type { InitialGoalOverviewContext } from '@lobechat/types';
import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:GoalContextSyntheticInjector');

const makeSyntheticToolCallId = () => `synthetic-getGoalContext-${Date.now()}`;

export interface GoalContextSyntheticInjectorConfig {
  enabled?: boolean;
  /**
   * Structured snapshot of the viewed goal — the injector owns rendering it
   * into the synthetic `getGoalContext` result body, so transports only ship
   * data and prompt wording stays in one place.
   */
  overview?: InitialGoalOverviewContext;
}

/**
 * Goal Context Synthetic Injector
 *
 * Injects a fake assistant(tool_call getGoalContext) + tool(result) pair after
 * the last user message, carrying the goal-page overview as environment
 * information (same topology as {@link OnboardingSyntheticStateInjector}).
 *
 * Why a tool pair rather than appending to the user message: environment state
 * the product injects is not something the user said. As a tool result it is
 * clearly machine-provided, survives user-message rendering untouched, and
 * keeps the action→feedback shape models already handle for tool output.
 */
export class GoalContextSyntheticInjector extends BaseProcessor {
  readonly name = 'GoalContextSyntheticInjector';

  constructor(
    private config: GoalContextSyntheticInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (!this.config.enabled || !this.config.overview) {
      log('Disabled or no overview, skipping');
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);

    let lastUserIdx = -1;
    for (let i = clonedContext.messages.length - 1; i >= 0; i--) {
      if (clonedContext.messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }

    if (lastUserIdx === -1) {
      log('No user message found, skipping');
      return this.markAsExecuted(context);
    }

    const toolCallId = makeSyntheticToolCallId();

    const assistantMsg: Message = {
      content: '',
      id: `synthetic-assistant-goal-${Date.now()}`,
      role: 'assistant',
      tool_calls: [
        {
          function: {
            arguments: '{}',
            name: 'getGoalContext',
          },
          id: toolCallId,
          type: 'function',
        },
      ],
    };

    const toolMsg: Message = {
      content: buildGoalOverviewPrompt(this.config.overview),
      id: `synthetic-tool-goal-${Date.now()}`,
      role: 'tool',
      tool_call_id: toolCallId,
    };

    clonedContext.messages.splice(lastUserIdx + 1, 0, assistantMsg, toolMsg);

    log('Injected synthetic getGoalContext pair after user message %d', lastUserIdx);
    return this.markAsExecuted(clonedContext);
  }
}
