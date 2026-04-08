import debug from 'debug';

import { BaseVirtualLastUserContentProvider } from '../base/BaseVirtualLastUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';
import type { OnboardingContextInjectorConfig } from './OnboardingContextInjector';

const log = debug('context-engine:provider:OnboardingActionHintInjector');

/**
 * Onboarding Action Hint Injector
 * Injects a standalone virtual user message AFTER the last user message with phase-specific
 * tool call directives. This is a separate message (not appended to the user's message)
 * so the model treats it as a distinct instruction rather than part of the user's input.
 */
export class OnboardingActionHintInjector extends BaseVirtualLastUserContentProvider {
  readonly name = 'OnboardingActionHintInjector';

  constructor(
    private config: OnboardingContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected shouldSkip(_context: PipelineContext): boolean {
    if (!this.config.enabled || !this.config.onboardingContext?.phaseGuidance) {
      log('Disabled or no phaseGuidance configured, skipping');
      return true;
    }
    return false;
  }

  protected buildContent(_context: PipelineContext): string | null {
    const ctx = this.config.onboardingContext;
    if (!ctx) return null;

    const hints: string[] = [];
    const phase = ctx.phaseGuidance;

    // Detect empty documents and nudge tool calls
    if (!ctx.soulContent) {
      hints.push(
        'SOUL.md is empty — call updateDocument(type="soul") to write the agent identity once the user gives you a name and emoji.',
      );
    }
    if (!ctx.personaContent) {
      hints.push(
        'User Persona is empty — call updateDocument(type="persona") to persist what you learn about the user.',
      );
    }

    // Phase-specific persistence reminders
    if (phase.includes('Agent Identity')) {
      hints.push(
        'When the user settles on a name and emoji: call saveUserQuestion with agentName and agentEmoji, then call updateDocument(type="soul") to write SOUL.md.',
      );
    } else if (phase.includes('User Identity')) {
      hints.push(
        'When you learn the user\'s name: call saveUserQuestion with fullName, then call updateDocument(type="persona") to start the persona document.',
      );
    } else if (phase.includes('Discovery')) {
      hints.push(
        'Continue exploring. After sufficient discovery (5-6 exchanges), call saveUserQuestion with interests and responseLanguage. Update the persona document with updateDocument(type="persona") as you learn more.',
      );
      hints.push(
        'EARLY EXIT: If the user signals they want to finish (e.g., "好了", "谢谢", "行", "Done", asking for summary, or any completion signal), STOP exploring immediately. Save whatever fields you have (call saveUserQuestion with interests even if partial), present a brief summary, then call finishOnboarding. Do NOT continue asking questions after a completion signal.',
      );
    } else if (phase.includes('Summary')) {
      hints.push(
        'Present a summary, then after user confirmation call finishOnboarding with a warm closing message. You MUST call finishOnboarding before the conversation ends — do not keep asking questions after the user confirms the summary.',
      );
    }

    hints.push(
      'You MUST call the persistence tools (saveUserQuestion, updateDocument) to save information as you collect it. Simply acknowledging in conversation is NOT enough — data must be persisted via tool calls.',
    );
    hints.push(
      'REMINDER: If the user says "好了", "谢谢", "行", "Done", "Thanks", or gives any completion signal at ANY phase, you MUST wrap up immediately and call finishOnboarding. This overrides all other phase rules.',
    );

    return `<next_actions>\n${hints.join('\n')}\n</next_actions>`;
  }

  /**
   * Override: always create a standalone virtual user message instead of appending
   * to the last user message. This keeps the action hints visually and semantically
   * separate from the user's actual input.
   */
  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (this.shouldSkip(context)) {
      return this.markAsExecuted(context);
    }

    const content = this.buildContent(context);
    if (!content) {
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);
    clonedContext.messages.push(this.createVirtualLastUserMessage(content));

    return this.markAsExecuted(clonedContext);
  }
}
