import debug from 'debug';

import type { SkillMeta } from '../../providers/SkillContextProvider';
import type {
  ActivatedStepSkill,
  OperationSkillSet,
  ResolvedSkillSet,
  StepSkillDelta,
} from './types';

const log = debug('context-engine:skill-resolver');

/**
 * Unified skill resolution engine.
 *
 * Single entry-point that merges operation-level skills with step-level
 * dynamic activations (activateSkill tool calls) and produces the final
 * ResolvedSkillSet consumed by SkillContextProvider.
 *
 * Analogous to ToolResolver for tools.
 */
export class SkillResolver {
  /**
   * Resolve the final skill set for an LLM call.
   *
   * @param operationSkillSet       Immutable skills determined at operation creation
   * @param stepDelta               Declarative skill changes for the current step
   * @param accumulatedActivations  Skills activated in previous steps (cumulative)
   */
  resolve(
    operationSkillSet: OperationSkillSet,
    stepDelta: StepSkillDelta,
    accumulatedActivations: ActivatedStepSkill[] = [],
  ): ResolvedSkillSet {
    const enabledPluginIds = new Set(operationSkillSet.enabledPluginIds);

    // Collect all step-level activations (accumulated + current delta)
    const stepActivatedMap = new Map<string, { content?: string }>();

    for (const activation of accumulatedActivations) {
      stepActivatedMap.set(activation.identifier, { content: activation.content });
    }

    for (const activation of stepDelta.activatedSkills) {
      stepActivatedMap.set(activation.identifier, { content: activation.content });
    }

    // Resolve each skill
    const enabledSkills: SkillMeta[] = operationSkillSet.skills.map((skill) => {
      const isOperationActivated = enabledPluginIds.has(skill.identifier);
      const stepActivation = stepActivatedMap.get(skill.identifier);
      const isStepActivated = !!stepActivation;
      // Step delta content overrides original content if provided
      const resolvedContent = stepActivation?.content || skill.content;

      // Being pinned (isOperationActivated) alone must NOT force `activated:
      // true` when there's no real content to inject — e.g. a ZIP-bundled
      // skill whose content is deliberately withheld until `activateSkill`
      // mounts its bundle (see resolveClientSkills / aiAgent's skills build).
      // Force-activating it anyway would make it vanish from BOTH the
      // injected content (no content to show) and SkillContextProvider's
      // <available_skills> list (which only lists non-activated skills) —
      // making a pinned-but-unmounted skill invisible to the model entirely.
      // Falling through here keeps it listed as available so the model can
      // still discover and activate it.
      if ((isOperationActivated || isStepActivated) && resolvedContent) {
        return {
          ...skill,
          activated: true,
          content: resolvedContent,
        };
      }

      return skill;
    });

    if (stepDelta.activatedSkills.length > 0) {
      log(
        'Step-level skill activations: %o',
        stepDelta.activatedSkills.map((s) => s.identifier),
      );
    }

    return { enabledSkills };
  }
}
