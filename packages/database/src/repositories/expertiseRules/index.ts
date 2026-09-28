import type {
  ExpertiseEnforcement,
  ExpertiseLessonSection,
  ExpertiseReasonKind,
} from '@lobechat/types';

import { ExpertiseModel } from '../../models/expertise';
import type { LobeChatDatabase } from '../../type';

export type RuleSectionPatch = Partial<Record<'rule' | 'why' | 'how' | 'limits', string | null>>;

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
  private readonly model: ExpertiseModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.model = new ExpertiseModel(db, userId, workspaceId);
  }

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
  updateRule = async (lessonId: string, patch: UpdateRulePatch) => {
    const lesson = await this.model.findLesson(lessonId);
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
    const feedback = titleChanged
      ? title!
      : (Object.values(patch.sections ?? {})
          .find(Boolean)
          ?.trim() ?? null);

    const revision = await this.inTransaction(async (model) => {
      let next = lesson.currentRevision;
      if (versioned) {
        // Take the next number under a row lock: two edits racing on a stale read would
        // otherwise both claim it and trip the (lesson, revision) unique key.
        next = ((await model.lockLessonRevision(lessonId)) ?? lesson.currentRevision) + 1;
        await model.insertLessonRevision({
          changedBy: 'user',
          changedByUserId: this.userId,
          feedback,
          kind: 'user-feedback',
          lessonId,
          prevTitle: titleChanged ? lesson.title : null,
          revision: next,
          sections,
        });
      }
      await model.updateLessonFields(lessonId, {
        ...(patch.compilability && { compilability: patch.compilability }),
        ...(patch.enforcement && { enforcement: patch.enforcement }),
        ...(patch.reasonKind && { reasonKind: patch.reasonKind }),
        ...(titleChanged && { title }),
        ...(sectionsChanged && { sections }),
        // A switch flip is not a revision and must not write back a number it read earlier.
        ...(versioned && { currentRevision: next }),
      });
      return next;
    });
    return { id: lessonId, revision };
  };

  /**
   * Folds one rule into another: the counts move to the target, the target gets a `generalize`
   * revision naming what it absorbed and a lineage pointer to read the source's evidence, and the
   * source is retired with a pointer back. Nothing is deleted — the archived source still opens
   * and still says where it went.
   */
  mergeRules = async (fromId: string, intoId: string) => {
    if (fromId === intoId) return null;
    const [from, into] = await Promise.all([
      this.model.findLesson(fromId),
      this.model.findLesson(intoId),
    ]);
    if (!from || !into) return null;
    // Folding into an archived rule would leave neither rule in force.
    if (from.status !== 'active' || into.status !== 'active') return null;

    const revision = await this.inTransaction(async (model) => {
      const next = ((await model.lockLessonRevision(intoId)) ?? into.currentRevision) + 1;
      // The evidence stays where it is; `generalizedFromIds` is how the target reads it.
      await model.insertLessonRevision({
        changedBy: 'user',
        changedByUserId: this.userId,
        feedback: from.title,
        kind: 'generalize',
        lessonId: intoId,
        prevTitle: null,
        revision: next,
        sections: into.sections,
      });
      await model.updateLessonFields(intoId, {
        currentRevision: next,
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
      return next;
    });
    return { fromId, intoId, revision };
  };
}
