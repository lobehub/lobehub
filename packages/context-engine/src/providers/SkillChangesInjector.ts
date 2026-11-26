import debug from 'debug';

import { BaseEveryUserContentProvider } from '../base/BaseEveryUserContentProvider';
import type { Message, ProcessorOptions } from '../types';
import type { SkillChangesByMessage } from './SkillIndexSnapshot';
import { formatSkillChanges } from './SkillIndexSnapshot';

const log = debug('context-engine:provider:SkillChangesInjector');

export interface SkillChangesInjectorConfig {
  /**
   * Whether the run was sent the `activateSkill` tool. Mirrors
   * `SkillContextProviderConfig.canActivateSkill`. Defaults to true.
   */
  canActivateSkill?: boolean;
  /** Change notes keyed by the user message each was attached to. */
  changes?: SkillChangesByMessage;
  enabled?: boolean;
}

/**
 * Attaches each skill-index change note to the user message it belongs to.
 *
 * The `<available_skills>` block in message `[0]` renders a snapshot that stays
 * fixed while the prompt cache is warm (see `resolveSkillIndex`); these notes
 * tell the model which skills were added, updated, or removed since. Every note
 * stays on its own user message and renders identically on every later request,
 * so earlier turns keep their cached bytes.
 */
export class SkillChangesInjector extends BaseEveryUserContentProvider {
  readonly name = 'SkillChangesInjector';

  constructor(
    private config: SkillChangesInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContentForMessage(
    message: Message,
  ): { content: string; contextType: string } | null {
    if (this.config.enabled === false || !message.id) return null;

    const changes = this.config.changes?.[message.id];
    if (!changes || changes.length === 0) return null;

    log('Attaching %d skill changes to message %s', changes.length, message.id);
    return {
      content: formatSkillChanges(changes, { canActivateSkill: this.config.canActivateSkill }),
      contextType: 'skills_changes',
    };
  }
}
