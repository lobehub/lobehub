import debug from 'debug';

import { BaseFirstUserContentProvider } from '../base/BaseFirstUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:GTDPlanInjector');

/**
 * GTD Plan data structure
 * Represents a high-level plan document
 */
export interface GTDPlan {
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

export interface GTDPlanInjectorConfig {
  /** Whether GTD Plan injection is enabled */
  enabled?: boolean;
  /** The current plan to inject */
  plan?: GTDPlan;
}

/**
 * Format GTD Plan content for injection
 */
function formatGTDPlan(plan: GTDPlan): string {
  const lines: string[] = ['<gtd_plan>', `<goal>${plan.goal}</goal>`];

  if (plan.description) {
    lines.push(`<description>${plan.description}</description>`);
  }

  if (plan.context) {
    lines.push(`<context>${plan.context}</context>`);
  }

  lines.push(`<status>${plan.completed ? 'completed' : 'in_progress'}</status>`);
  lines.push('</gtd_plan>');

  return lines.join('\n');
}

/**
 * GTD Plan Injector
 * Responsible for injecting the current plan into context before the first user message
 * This provides the AI with awareness of the user's current goal and plan context
 */
export class GTDPlanInjector extends BaseFirstUserContentProvider {
  readonly name = 'GTDPlanInjector';

  constructor(
    private config: GTDPlanInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContent(_context: PipelineContext): string | null {
    const { enabled, plan } = this.config;

    if (!enabled || !plan) {
      log('GTD Plan not enabled or no plan provided');
      return null;
    }

    // Skip if plan is completed
    if (plan.completed) {
      log('Plan is completed, skipping injection');
      return null;
    }

    const formattedContent = formatGTDPlan(plan);

    log(`GTD Plan prepared: goal="${plan.goal}"`);

    return formattedContent;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const result = await super.doProcess(context);

    // Update metadata
    if (this.config.enabled && this.config.plan && !this.config.plan.completed) {
      result.metadata.gtdPlanInjected = true;
      result.metadata.gtdPlanId = this.config.plan.id;
    }

    return result;
  }
}
