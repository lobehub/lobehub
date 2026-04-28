import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { Message, PipelineContext, ProcessorOptions } from '../types';
import type { OnboardingContextInjectorConfig } from './OnboardingContextInjector';

const log = debug('context-engine:provider:OnboardingSyntheticStateInjector');

const makeSyntheticToolCallId = () => `synthetic-getOnboardingState-${Date.now()}`;

/**
 * Onboarding Synthetic State Injector
 *
 * Injects a fake assistant(tool_call) + tool(result) message pair after the
 * last user message to reproduce the V1 getOnboardingState topology.
 *
 * Why: In V1, getOnboardingState was called every turn. Its tool-role result
 * created an action→feedback→action chain that drove models to call subsequent
 * persistence tools. Simply injecting the same info as user-role content does
 * not trigger this chain. By faking the tool call pair, the model sees the
 * same message topology as V1 and resumes the action loop.
 */
export class OnboardingSyntheticStateInjector extends BaseProcessor {
  readonly name = 'OnboardingSyntheticStateInjector';

  constructor(
    private config: OnboardingContextInjectorConfig,
    _options: ProcessorOptions = {},
  ) {
    super(_options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (!this.config.enabled || !this.config.onboardingContext?.phaseGuidance) {
      log('Disabled or no phaseGuidance, skipping');
      return this.markAsExecuted(context);
    }

    const ctx = this.config.onboardingContext;

    // Build the synthetic tool result content (mimics getOnboardingState response)
    const stateResult = this.buildStateResult(
      ctx.phaseGuidance,
      ctx.soulContent,
      ctx.personaContent,
    );

    const clonedContext = this.cloneContext(context);

    // Find the last user message index
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

    // Insert the pair right after the last user message
    const insertIdx = lastUserIdx + 1;

    const toolCallId = makeSyntheticToolCallId();

    const assistantMsg: Message = {
      content: '',
      id: `synthetic-assistant-${Date.now()}`,
      role: 'assistant',
      tool_calls: [
        {
          function: {
            arguments: '{}',
            name: 'lobe-web-onboarding____getOnboardingState____builtin',
          },
          id: toolCallId,
          type: 'function',
        },
      ],
    };

    const toolMsg: Message = {
      content: stateResult,
      id: `synthetic-tool-${Date.now()}`,
      role: 'tool',
      tool_call_id: toolCallId,
    };

    clonedContext.messages.splice(insertIdx, 0, assistantMsg, toolMsg);

    log('Injected synthetic getOnboardingState pair at index %d', insertIdx);
    return this.markAsExecuted(clonedContext);
  }

  private buildStateResult(
    phaseGuidance: string,
    soulContent?: string | null,
    personaContent?: string | null,
  ): string {
    const parts: string[] = [phaseGuidance];

    if (soulContent) {
      parts.push(`<current_soul_document>\n${soulContent}\n</current_soul_document>`);
    }
    if (personaContent) {
      parts.push(`<current_user_persona>\n${personaContent}\n</current_user_persona>`);
    }

    return parts.join('\n\n');
  }
}
