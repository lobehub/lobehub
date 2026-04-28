import debug from 'debug';

import { BaseFirstUserContentProvider } from '../base/BaseFirstUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:OnboardingContextInjector');

export interface OnboardingContext {
  /** User persona document content (markdown) */
  personaContent?: string | null;
  /** Formatted phase guidance from getOnboardingState */
  phaseGuidance: string;
  /** SOUL.md document content */
  soulContent?: string | null;
}

export interface OnboardingContextInjectorConfig {
  enabled?: boolean;
  onboardingContext?: OnboardingContext;
}

/**
 * Onboarding Context Injector (FirstUser position)
 * Injects onboarding phase guidance and document contents before the first user message.
 * Stable content that benefits from KV cache hits.
 */
export class OnboardingContextInjector extends BaseFirstUserContentProvider {
  readonly name = 'OnboardingContextInjector';

  constructor(
    private config: OnboardingContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContent(context: PipelineContext): string | null {
    if (!this.config.enabled || !this.config.onboardingContext?.phaseGuidance) {
      log('Disabled or no phaseGuidance configured, skipping injection');
      return null;
    }

    const alreadyInjected = context.messages.some(
      (message) =>
        typeof message.content === 'string' && message.content.includes('<onboarding_context>'),
    );

    if (alreadyInjected) {
      log('Onboarding context already injected, skipping');
      return null;
    }

    const { onboardingContext } = this.config;
    const parts: string[] = [onboardingContext.phaseGuidance];

    if (onboardingContext.soulContent) {
      parts.push(
        `<current_soul_document>\n${numberLines(onboardingContext.soulContent)}\n</current_soul_document>`,
      );
    }

    if (onboardingContext.personaContent) {
      parts.push(
        `<current_user_persona>\n${numberLines(onboardingContext.personaContent)}\n</current_user_persona>`,
      );
    }

    return `<onboarding_context>\n${parts.join('\n\n')}\n</onboarding_context>`;
  }
}

/**
 * Prefix each line with a 1-based line number and `→` separator, mirroring the
 * format the updateDocument tool's line-based hunks (`deleteLines`, `insertAt`,
 * `replaceLines`) expect. A trailing newline is treated as a terminator, not as
 * a phantom empty line.
 */
const numberLines = (source: string): string => {
  const normalized = source.endsWith('\n') ? source.slice(0, -1) : source;
  const lines = normalized === '' ? [''] : normalized.split('\n');
  const width = Math.max(String(lines.length).length, 2);
  return lines.map((line, i) => `${String(i + 1).padStart(width, ' ')}→${line}`).join('\n');
};
