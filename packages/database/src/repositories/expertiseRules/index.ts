import type {
  ExpertiseEnforcement,
  ExpertiseLessonSection,
  ExpertiseReasonKind,
} from '@lobechat/types';

import { ExpertiseModel } from '../../models/expertise';
import type { LobeChatDatabase } from '../../type';

export type RuleSectionPatch = Partial<Record<'rule' | 'why' | 'how' | 'limits', string | null>>;

/** Where a distilled rule was read from, as the distill step resolved it. */
export interface DistilledMaterial {
  subjectId: string | null;
  subjectType: 'document' | 'standalone' | 'topic';
  title: string;
  type: 'document' | 'file' | 'text' | 'topic';
}

/** One candidate the reviewer kept: filed as a new rule, or recorded on a rule that says it. */
export type DistilledItem =
  | {
      domainId?: string;
      kind: 'create';
      /** Opened only when no existing group was chosen. */
      newGroup?: { gate: string; title: string };
      quote: string;
      rule: {
        compilability?: 'compilable' | 'not-compilable';
        enforcement?: ExpertiseEnforcement;
        how?: string;
        limits?: string;
        title: string;
        why?: string;
      };
    }
  | { intoId: string; kind: 'merge'; quote: string };

export interface UpdateRulePatch {
  compilability?: 'compilable' | 'not-compilable';
  enforcement?: ExpertiseEnforcement;
  reasonKind?: ExpertiseReasonKind;
  sections?: RuleSectionPatch;
  title?: string;
}

/**
 * Cross-table write flows for the reviewer's rules. A versioned edit and a merge each write the
 * lesson row and its edit history together, so they run as one transaction here and compose the
 * single-table pieces on {@link ExpertiseModel}. Reads and single-table writes stay on the model.
 */
export class ExpertiseRuleRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private inTransaction = <T>(run: (model: ExpertiseModel) => Promise<T>) =>
    this.db.transaction((tx) =>
      run(new ExpertiseModel(tx as LobeChatDatabase, this.userId, this.workspaceId)),
    );

  /**
   * Field-level edits from the rule document. Wording and body edits are versioned like a
   * conversational correction — same table, same `user-feedback` kind — so the history reads as
   * one list whether the reviewer typed a sentence or rewrote a paragraph. Switches (enforcement,
   * compilability, reason kind) are not versioned: they are settings, not judgments.
   */
  updateRule = async (lessonId: string, patch: UpdateRulePatch) =>
    this.inTransaction(async (model) => {
      // The patch is applied to the row as it is now, not as this request first read it: two
      // members saving different sections at once must both keep their edit.
      const lesson = await model.lockLesson(lessonId);
      if (!lesson) return null;

      const title = patch.title?.trim();
      const titleChanged = Boolean(title) && title !== lesson.title;

      let sections = lesson.sections;
      let sectionsChanged = false;
      if (patch.sections) {
        sections = lesson.sections.filter((section) => !(section.key in patch.sections!));
        for (const [key, body] of Object.entries(patch.sections)) {
          const text = body?.trim();
          if (text) sections.push({ body: text, key: key as ExpertiseLessonSection['key'] });
        }
        sectionsChanged = true;
      }
      // The rule sentence and the title are the same words seen from two places.
      if (titleChanged && !patch.sections?.rule) {
        sections = [
          { body: title!, key: 'rule' as const },
          ...sections.filter((section) => section.key !== 'rule'),
        ];
        sectionsChanged = true;
      }

      const versioned = titleChanged || sectionsChanged;
      const revision = versioned ? lesson.currentRevision + 1 : lesson.currentRevision;
      if (versioned) {
        await model.insertLessonRevision({
          changedBy: 'user',
          changedByUserId: this.userId,
          feedback: titleChanged
            ? title!
            : (Object.values(patch.sections ?? {})
                .find(Boolean)
                ?.trim() ?? null),
          kind: 'user-feedback',
          lessonId,
          prevTitle: titleChanged ? lesson.title : null,
          revision,
          sections,
        });
      }
      await model.updateLessonFields(lessonId, {
        ...(patch.compilability && { compilability: patch.compilability }),
        ...(patch.enforcement && { enforcement: patch.enforcement }),
        ...(patch.reasonKind && { reasonKind: patch.reasonKind }),
        ...(titleChanged && { title }),
        ...(sectionsChanged && { sections }),
        // A switch flip is not a revision and never writes the number back.
        ...(versioned && { currentRevision: revision }),
      });
      return { id: lessonId, revision };
    });

  /**
   * Files what the reviewer kept from one material, in one transaction. Each group touched gets
   * one run for this material (so the sources list can say "read from <material>"), every kept
   * rule gets the passage it was read from, and a candidate that restated an existing rule is
   * recorded on that rule instead of being filed twice. Returns the rules now carrying it.
   */
  commitDistilled = async (material: DistilledMaterial, items: DistilledItem[]) => {
    if (items.length === 0) return [];
    const commitId = crypto.randomUUID();
    const reflectionKey = `material:${material.type}:${commitId}`;
    return this.inTransaction(async (model) => {
      const runs = new Map<string, string>();
      const runFor = async (domainId: string) => {
        const existing = runs.get(domainId);
        if (existing) return existing;
        const runId = await model.insertMaterialRun({
          domainId,
          reflectionKey,
          subjectId: material.subjectId ?? commitId,
          subjectType: material.subjectType,
        });
        runs.set(domainId, runId);
        return runId;
      };
      // Several candidates may propose the same new group; open it once.
      const openedGroups = new Map<string, string>();
      const results: { id: string; kind: DistilledItem['kind'] }[] = [];

      for (const item of items) {
        if (item.kind === 'merge') {
          const target = await model.lockLesson(item.intoId);
          if (!target || target.status !== 'active') continue;
          const runId = await runFor(target.domainId);
          await model.insertMaterialHit({
            domainId: target.domainId,
            lessonId: target.id,
            quote: item.quote,
            runId,
            where: material.title,
          });
          await model.updateLessonFields(target.id, { exampleCount: target.exampleCount + 1 });
          results.push({ id: target.id, kind: 'merge' });
          continue;
        }

        let domainId = item.domainId;
        if (!domainId && item.newGroup) {
          const key = item.newGroup.title.trim().toLowerCase();
          domainId =
            openedGroups.get(key) ??
            (await model.createRuleGroup({ gate: item.newGroup.gate, title: item.newGroup.title }));
          if (domainId) openedGroups.set(key, domainId);
        }
        if (!domainId) continue;

        const runId = await runFor(domainId);
        const created = await model.createRule({ ...item.rule, domainId, originRunId: runId });
        if (!created) continue;
        const hitId = await model.insertMaterialHit({
          domainId,
          lessonId: created.id,
          quote: item.quote,
          runId,
          where: material.title,
        });
        await model.updateLessonFields(created.id, { exampleCount: 1, originHitId: hitId });
        results.push({ id: created.id, kind: 'create' });
      }
      return results;
    });
  };

  /**
   * Folds one rule into another: the counts move to the target, the target gets a `generalize`
   * revision naming what it absorbed and a lineage pointer to read the source's evidence, and the
   * source is retired with a pointer back. Nothing is deleted — the archived source still opens
   * and still says where it went.
   */
  mergeRules = async (fromId: string, intoId: string) => {
    if (fromId === intoId) return null;
    return this.inTransaction(async (model) => {
      // Both rows are read under a lock, in a fixed order so two merges of the same pair cannot
      // deadlock, and the counts are summed from what they hold now.
      const locked = new Map<string, Awaited<ReturnType<ExpertiseModel['lockLesson']>>>();
      for (const id of [fromId, intoId].sort()) locked.set(id, await model.lockLesson(id));
      const from = locked.get(fromId);
      const into = locked.get(intoId);
      if (!from || !into) return null;
      // Folding into an archived rule would leave neither rule in force.
      if (from.status !== 'active' || into.status !== 'active') return null;
      // Folding across reaches (the reviewer's rules vs an agent's lessons, or two agents) would
      // change which runs receive it; only newer clients hide those targets, so refuse it here.
      if (!(await model.sameReach(from.domainId, into.domainId))) return null;

      const revision = into.currentRevision + 1;
      // The evidence stays where it is; `generalizedFromIds` is how the target reads it.
      await model.insertLessonRevision({
        changedBy: 'user',
        changedByUserId: this.userId,
        feedback: from.title,
        kind: 'generalize',
        lessonId: intoId,
        prevTitle: null,
        revision,
        sections: into.sections,
      });
      await model.updateLessonFields(intoId, {
        currentRevision: revision,
        exampleCount: into.exampleCount + from.exampleCount,
        falsePositiveCount: into.falsePositiveCount + from.falsePositiveCount,
        generalizedFromIds: [...(into.generalizedFromIds ?? []), fromId],
        hitCount: into.hitCount + from.hitCount,
        lastHitAt:
          from.lastHitAt && (!into.lastHitAt || from.lastHitAt > into.lastHitAt)
            ? from.lastHitAt
            : into.lastHitAt,
      });
      // Recount over the merged lineage instead of adding the two counters.
      await model.updateLessonFields(intoId, { hitRunCount: await model.countLineageRuns(intoId) });
      await model.updateLessonFields(fromId, {
        rejectedReason: `merged-into:${intoId}`,
        retiredAt: new Date(),
        status: 'retired',
      });
      return { fromId, intoId, revision };
    });
  };
}
