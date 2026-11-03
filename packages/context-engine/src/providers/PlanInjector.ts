import debug from 'debug';

import { BaseFirstUserContentProvider } from '../base/BaseFirstUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    planId?: string;
    planInjected?: boolean;
  }
}

const log = debug('context-engine:provider:PlanInjector');

/**
 * Plan data structure
 * Represents a high-level plan document
 */
export interface Plan {
  /** Whether the plan is completed */
  completed: boolean;
  /** Detailed context, background, constraints */
  context?: string;
  /** Creation timestamp */
  createdAt: string;
  /** Brief summary of the plan */
  description: string;
  /** The main goal or objective */
  goal: string;
  /** Unique plan identifier */
  id: string;
  /** Last update timestamp */
  updatedAt: string;
}

export interface PlanInjectorConfig {
  /** Whether Plan injection is enabled */
  enabled?: boolean;
  /** The current plan to inject */
  plan?: Plan;
}

/**
 * Format Plan content for injection
 */
function formatPlan(plan: Plan): string {
  const lines: string[] = ['<plan>', `<goal>${plan.goal}</goal>`];

  if (plan.description) {
    lines.push(`<description>${plan.description}</description>`);
  }

  if (plan.context) {
    lines.push(`<context>${plan.context}</context>`);
  }

  lines.push(`<status>${plan.completed ? 'completed' : 'in_progress'}</status>`);
  lines.push('</plan>');

  return lines.join('\n');
}

/**
 * Plan Injector
 * Responsible for injecting the current plan into context before the first user message
 * This provides the AI with awareness of the user's current goal and plan context
 */
export class PlanInjector extends BaseFirstUserContentProvider {
  readonly name = 'PlanInjector';

  constructor(
    private config: PlanInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContent(_context: PipelineContext): string | null {
    const { enabled, plan } = this.config;

    if (!enabled || !plan) {
      log('Plan not enabled or no plan provided');
      return null;
    }

    if (plan.completed) {
      log('Plan is completed, skipping injection');
      return null;
    }

    const formattedContent = formatPlan(plan);

    log(`Plan prepared: goal="${plan.goal}"`);

    return formattedContent;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const result = await super.doProcess(context);

    if (this.config.enabled && this.config.plan && !this.config.plan.completed) {
      result.metadata.planInjected = true;
      result.metadata.planId = this.config.plan.id;
    }

    return result;
  }
}
