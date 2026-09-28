import { type AgentIdentityContext, agentIdentityPrompt } from '@lobechat/prompts';
import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    agentIdentityInjected?: boolean;
  }
}

const log = debug('context-engine:provider:AgentIdentityInjector');

export interface AgentIdentityInjectorConfig {
  /** Whether identity injection is enabled */
  enabled?: boolean;
  /** The agent's identity (personal name + role title) */
  identity?: AgentIdentityContext;
}

/**
 * Agent Identity Injector
 *
 * Appends the agent's identity (name / title) to the system message so the
 * model can answer "who are you?" with the name the user gave it. The identity
 * lives outside the prompt text (`agents.name` / `agents.title`), so an agent
 * with a custom persona but no self-introduction in its systemRole would
 * otherwise fall back to the product or model name.
 *
 * Group chat is expected to disable this — GroupContextInjector already
 * establishes the speaking agent's identity there.
 */
export class AgentIdentityInjector extends BaseSystemRoleProvider {
  readonly name = 'AgentIdentityInjector';

  constructor(
    private config: AgentIdentityInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (this.config.enabled === false) {
      log('Disabled, skipping identity injection');
      return null;
    }

    const content = agentIdentityPrompt(this.config.identity ?? {});
    if (!content) {
      log('No agent identity configured, skipping injection');
      return null;
    }

    return content;
  }

  protected onInjected(context: PipelineContext, content: string): void {
    context.metadata.agentIdentityInjected = true;
    log(`Agent identity injected: "${content.slice(0, 80)}..."`);
  }
}
