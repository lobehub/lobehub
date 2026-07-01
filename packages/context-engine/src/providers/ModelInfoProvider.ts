import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    modelInfoInjected?: boolean;
  }
}

const log = debug('context-engine:provider:ModelInfoProvider');

export interface ModelInfoProviderConfig {
  /** Human-friendly model name, e.g. `Fable 5`. */
  displayName?: string;
  enabled?: boolean;
  /** Model knowledge cutoff date, e.g. `2024-06`. */
  knowledgeCutoff?: string;
  /** Model runtime id, e.g. `claude-fable-5`. */
  modelId?: string;
}

/**
 * Injects runtime model metadata (name, id, knowledge cutoff) into the system
 * message so the model can accurately answer "which model are you".
 *
 * Models do not reliably know their own identity from weights, so we surface it
 * here for every agent — this used to rely on a `{{model}}` placeholder that only
 * the builtin inbox agent's system role happened to include; custom agents lost it.
 */
export class ModelInfoProvider extends BaseSystemRoleProvider {
  readonly name = 'ModelInfoProvider';

  constructor(
    private config: ModelInfoProviderConfig = {},
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (this.config.enabled === false) {
      log('Model info injection disabled, skipping');
      return null;
    }

    const modelId = this.config.modelId?.trim();
    const displayName = this.config.displayName?.trim();
    const knowledgeCutoff = this.config.knowledgeCutoff?.trim();

    // Only surface identity when we know the model's real name (resolved from the
    // model bank). The id rides along in parens. A bare runtime id without a name
    // is often a meaningless slug, so we skip it rather than mislead the model.
    const modelLabel = displayName
      ? modelId && displayName !== modelId
        ? `${displayName} (${modelId})`
        : displayName
      : undefined;

    const lines = [
      modelLabel && `Current model: ${modelLabel}`,
      knowledgeCutoff && `Model knowledge cutoff: ${knowledgeCutoff}`,
    ].filter(Boolean);

    if (lines.length === 0) {
      log('No model info configured, skipping injection');
      return null;
    }

    return lines.join('\n');
  }

  protected onInjected(context: PipelineContext): void {
    context.metadata.modelInfoInjected = true;
  }
}
