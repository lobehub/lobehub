'use client';

import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { Block, Flexbox, Icon, TextArea } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  confirmModal,
  type DropdownItem,
  DropdownMenu,
  Select,
  Tag,
  Text,
  toast,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ChevronRight,
  ChevronUp,
  CircleDashed,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import {
  CriterionList,
  CriterionRequiredChip,
  CriterionRow,
  openCriterionEditModal,
} from '@/features/Acceptance/CriterionList';
import { useRubrics } from '@/features/Acceptance/hooks';
import { usePermission } from '@/hooks/usePermission';
import { useSingleton } from '@/hooks/useSingleton';
import { type VerifyCriterionDraft, verifyService } from '@/services/verify';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { resolveTaskAcceptanceGoal } from './resolveTaskAcceptanceGoal';
import { TaskAcceptanceHeader } from './TaskAcceptanceHeader';

const SAVE_DEBOUNCE_MS = 600;

const styles = createStaticStyles(({ css, cssVar }) => ({
  collapsedRequirement: css`
    /* full requirement, wrapping to as many lines as it needs — readable at a glance.
       Inset past the trigger icon so it reads flat under the title, not as a clickable row. */
    padding-inline: 32px 8px;
    line-height: 1.5;
  `,
  list: css`
    width: 100%;
  `,
  row: css`
    cursor: pointer;
    padding-block: 10px;
    padding-inline: 12px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  rowTitle: css`
    flex: 1;
  `,
  section: css`
    padding-block: 12px;
    padding-inline: 12px;
  `,
  subtitle: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

/** Working item: a draft plus a stable client id, so reorder/edit is jitter-free. */
interface DraftItem extends VerifyCriterionDraft {
  /** Persisted logical identity. Kept across edits so Acceptance can join later runs. */
  criterionId?: string;
  /** Stable client-side id for list keys + dnd; not the persisted criterion id. */
  id: string;
}

let idSeq = 0;
const nextUid = () => `vc_${Date.now().toString(36)}_${(idSeq += 1)}`;

const toDraftItem = (draft: VerifyCriterionDraft, criterionId?: string): DraftItem => ({
  ...draft,
  criterionId,
  id: nextUid(),
});

export const isInvalidProviderApiKeyError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;

  const errorRecord = error as {
    data?: { errorData?: { errorType?: unknown }; errorType?: unknown };
    errorType?: unknown;
    message?: unknown;
  };

  return [
    errorRecord.errorType,
    errorRecord.message,
    errorRecord.data?.errorType,
    errorRecord.data?.errorData?.errorType,
  ].includes(AgentRuntimeErrorType.InvalidProviderAPIKey);
};

/** Snapshot task-owned criteria into independent rows before mounting them on a reusable rubric. */
export const toTemplateCriterionDrafts = (drafts: DraftItem[]): VerifyCriterionDraft[] =>
  drafts
    .filter((draft) => draft.title.trim().length > 0)
    .map(({ criterionId: _criterionId, id: _id, ...draft }) => ({
      ...draft,
      title: draft.title.trim(),
    }));

const TaskVerifyConfig = memo(() => {
  const { t } = useTranslation(['chat', 'verify']);

  const { allowed: canEditTask } = usePermission('create_content');

  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const taskDescription = useTaskStore(taskDetailSelectors.activeTaskDescription);
  const taskInstruction = useTaskStore(taskDetailSelectors.activeTaskInstruction);
  const taskName = useTaskStore(taskDetailSelectors.activeTaskName);
  const verify = useTaskStore(taskDetailSelectors.activeTaskVerifyConfig);
  const taskModel = useTaskStore(taskDetailSelectors.activeTaskModel);
  const taskProvider = useTaskStore(taskDetailSelectors.activeTaskProvider);
  const assigneeAgentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);

  // Resolve model/provider the same way TaskModelConfig does: task override first,
  // then the assignee agent's model, then the active agent for unassigned tasks.
  const agentModel = useAgentStore((s) =>
    assigneeAgentId
      ? agentByIdSelectors.getAgentModelById(assigneeAgentId)(s)
      : agentSelectors.currentAgentModel(s),
  );
  const agentProvider = useAgentStore((s) =>
    assigneeAgentId
      ? agentByIdSelectors.getAgentModelProviderById(assigneeAgentId)(s)
      : agentSelectors.currentAgentModelProvider(s),
  );
  const model = taskModel || agentModel || '';
  const provider = taskProvider || agentProvider || '';
  const taskAcceptanceGoal = resolveTaskAcceptanceGoal({
    description: taskDescription,
    instruction: taskInstruction,
    name: taskName,
  });
  const savedCount = verify?.verifyCriteriaIds?.length ?? 0;

  const { data: rubrics } = useRubrics();

  // ---- local working state ----
  const [requirement, setRequirement] = useState(verify?.requirement ?? '');
  const [enabled, setEnabled] = useState(verify?.enabled !== false);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  // Collapsed by default — the section is revealed by clicking the "+" trigger,
  // so it never sits open and noisy on a task that hasn't configured acceptance.
  const [expanded, setExpanded] = useState(false);

  // Hydrate the working list once per task from the persisted criterion ids.
  const hydratedTaskRef = useRef<string | null>(null);
  const criterionIds = useSingleton(() => new Map<string, string>());
  useEffect(() => {
    if (!taskId) return;
    if (hydratedTaskRef.current === taskId) return;
    hydratedTaskRef.current = taskId;
    setRequirement(verify?.requirement ?? '');
    setEnabled(verify?.enabled !== false);
    setShowTemplatePicker(false);
    criterionIds.clear();

    const ids = verify?.verifyCriteriaIds ?? [];
    if (ids.length === 0) {
      setDrafts([]);
      setHydrated(true);
      return;
    }
    setHydrated(false);
    verifyService
      .listCriteria()
      .then((all) => {
        const byId = new Map(all.map((c) => [c.id, c]));
        const ordered = ids
          .map((id) => byId.get(id))
          .filter((c): c is NonNullable<typeof c> => Boolean(c))
          .map((c) =>
            toDraftItem(
              {
                description: c.description ?? undefined,
                documentId: c.documentId,
                required: c.required,
                title: c.title,
                verifierConfig: c.verifierConfig ?? undefined,
                verifierType: c.verifierType,
              },
              c.id,
            ),
          );
        criterionIds.clear();
        for (const draft of ordered) {
          if (draft.criterionId) criterionIds.set(draft.id, draft.criterionId);
        }
        setDrafts(ordered);
      })
      .finally(() => setHydrated(true));
  }, [criterionIds, taskId, verify?.verifyCriteriaIds, verify?.requirement, verify?.enabled]);

  // ---- debounced persistence ----
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Latest not-yet-flushed payload; the debounce timer (or unmount flush) reads it.
  const pendingRef = useRef<{
    drafts: DraftItem[];
    enabled: boolean;
    requirement: string;
  } | null>(null);
  const savingRef = useRef(false);

  const doSave = useCallback(async () => {
    if (!taskId || savingRef.current) return;
    savingRef.current = true;
    try {
      while (pendingRef.current) {
        const payload = pendingRef.current;
        pendingRef.current = null;
        const cleaned = payload.drafts
          .filter((d) => d.title.trim().length > 0)
          .map((draft) => ({
            ...draft,
            criterionId: criterionIds.get(draft.id) ?? draft.criterionId,
          }));
        const requirement = payload.requirement.trim() || null;
        if (cleaned.length === 0) {
          await useTaskStore.getState().updateVerifyConfig(taskId, {
            enabled: payload.enabled,
            requirement,
            verifyCriteriaIds: null,
          });
          continue;
        }

        const existing = cleaned.filter((draft): draft is DraftItem & { criterionId: string } =>
          Boolean(draft.criterionId),
        );
        const localIds = await verifyService.forkRubricCriteria(
          existing.map(({ criterionId }) => criterionId),
        );
        existing.forEach((draft, index) => {
          draft.criterionId = localIds[index];
          criterionIds.set(draft.id, localIds[index]);
        });
        await Promise.all(
          existing.map(
            ({
              criterionId,
              description,
              documentId,
              required,
              title,
              verifierConfig,
              verifierType,
            }) =>
              verifyService.updateCriterion(criterionId, {
                description: description ?? null,
                documentId: documentId ?? null,
                required,
                title: title.trim(),
                verifierConfig,
                verifierType,
              }),
          ),
        );

        const additions = cleaned.filter((draft) => !draft.criterionId);
        const createdIds =
          additions.length === 0
            ? []
            : await verifyService.createCriteria(
                additions.map(({ criterionId: _criterionId, id: _id, ...draft }) => ({
                  ...draft,
                  title: draft.title.trim(),
                })),
              );
        additions.forEach((draft, index) => {
          draft.criterionId = createdIds[index];
          criterionIds.set(draft.id, createdIds[index]);
        });
        const ids = cleaned.map(({ criterionId }) => criterionId!);
        await useTaskStore.getState().updateVerifyConfig(taskId, {
          enabled: payload.enabled,
          requirement,
          verifyCriteriaIds: ids,
        });
        setDrafts((current) =>
          current.map((draft) => ({
            ...draft,
            criterionId: criterionIds.get(draft.id) ?? draft.criterionId,
          })),
        );
      }
    } catch (e) {
      console.error('[TaskVerifyConfig] Failed to save:', e);
    } finally {
      savingRef.current = false;
    }
  }, [criterionIds, taskId]);

  const persist = useCallback(
    (nextDrafts: DraftItem[], nextEnabled: boolean, nextRequirement: string) => {
      if (!taskId) return;
      pendingRef.current = {
        drafts: nextDrafts,
        enabled: nextEnabled,
        requirement: nextRequirement,
      };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => void doSave(), SAVE_DEBOUNCE_MS);
    },
    [taskId, doSave],
  );

  // On unmount, FLUSH any debounced-but-unsaved edit instead of dropping it —
  // this editor has no explicit Save button, so the timer is the only path.
  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (pendingRef.current) void doSave();
    },
    [doSave],
  );

  const commit = useCallback(
    (nextDrafts: DraftItem[], opts?: { enabled?: boolean; requirement?: string }) => {
      setDrafts(nextDrafts);
      const nextEnabled = opts?.enabled ?? enabled;
      const nextRequirement = opts?.requirement ?? requirement;
      if (opts?.enabled !== undefined) setEnabled(opts.enabled);
      if (opts?.requirement !== undefined) setRequirement(opts.requirement);
      persist(nextDrafts, nextEnabled, nextRequirement);
    },
    [enabled, requirement, persist],
  );

  // ---- actions ----
  const generateCriteria = useCallback(
    async (goal: string) => {
      if (!goal || generating || !model || !provider) return;
      setExpanded(true);
      setRequirement(goal);
      setGenerating(true);
      try {
        const generated = await verifyService.generateCriteria({
          context: taskName?.trim() ? `Task: ${taskName.trim()}` : undefined,
          goal,
          maxCriteria: 8,
          modelConfig: { model, provider },
        });
        if (generated.length === 0) throw new Error('No acceptance criteria were generated.');
        const items = generated.map((draft) => toDraftItem(draft));
        commit(items, { enabled: true, requirement: goal });
      } catch (error) {
        console.error('[TaskVerifyConfig] generate failed:', error);
        toast.error(
          isInvalidProviderApiKeyError(error)
            ? t('verifyConfig.generateInvalidProviderAPIKey', { model, provider })
            : t('verifyConfig.generateFailed'),
        );
      } finally {
        setGenerating(false);
      }
    },
    [commit, generating, model, provider, t, taskName],
  );

  const handleGenerate = useCallback(async () => {
    const goal = requirement.trim();
    if (!goal || generating || !model || !provider) return;
    await generateCriteria(goal);
  }, [generateCriteria, generating, model, provider, requirement]);

  const handleCollapsedClick = useCallback(() => {
    if (savedCount > 0 || requirement.trim()) {
      setExpanded(true);
      return;
    }
    void generateCriteria(taskAcceptanceGoal);
  }, [generateCriteria, requirement, savedCount, taskAcceptanceGoal]);

  const handleRemove = useCallback(
    (id: string) => {
      commit(drafts.filter((d) => d.id !== id));
    },
    [drafts, commit],
  );

  // One-click teardown of the whole acceptance config; collapses back to the
  // "+" trigger instead of leaving an empty editor open.
  const handleRemoveAll = useCallback(() => {
    confirmModal({
      content: t('taskDetail.acceptance.removeConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('taskDetail.acceptance.removeConfirm.ok'),
      onOk: () => {
        setExpanded(false);
        commit([], { enabled: false, requirement: '' });
      },
      title: t('taskDetail.acceptance.removeConfirm.title'),
    });
  }, [commit, t]);

  // New criteria are authored in the detail modal, not via an inline empty row —
  // so a half-typed criterion never leaks into the read-only preview.
  const handleManualAdd = useCallback(() => {
    openCriterionEditModal({
      criterion: { required: true, title: '', verifierType: 'llm' },
      isNew: true,
      onSubmit: (next) => commit([...drafts, toDraftItem(next)]),
    });
  }, [drafts, commit]);

  // Every row edits itself through the shared criterion modal — the same
  // interaction goal creation uses, so the two entries stay consistent.
  const openCriterionDetail = useCallback(
    (item: DraftItem) => {
      openCriterionEditModal({
        criterion: item,
        onDelete: () => handleRemove(item.id),
        onSubmit: (next) =>
          commit(drafts.map((draft) => (draft.id === item.id ? { ...draft, ...next } : draft))),
      });
    },
    [commit, drafts, handleRemove],
  );

  const handlePickTemplate = useCallback(
    async (rubricId: string) => {
      try {
        const criteria = await verifyService.getRubricCriteria(rubricId);
        const items = criteria.map((c) =>
          toDraftItem({
            description: c.description ?? undefined,
            documentId: c.documentId,
            required: c.required,
            title: c.title,
            verifierConfig: c.verifierConfig ?? undefined,
            verifierType: c.verifierType,
          }),
        );
        setShowTemplatePicker(false);
        commit(items);
      } catch (e) {
        console.error('[TaskVerifyConfig] template pick failed:', e);
      }
    },
    [commit],
  );

  const handleToggleEnabled = useCallback(
    (checked: boolean) => {
      commit(drafts, { enabled: checked });
    },
    [drafts, commit],
  );

  const handleRequirementChange = useCallback((value: string) => {
    setRequirement(value);
  }, []);

  const handleSaveAsTemplate = useCallback(async () => {
    const persistedIds = verify?.verifyCriteriaIds ?? [];
    if (persistedIds.length === 0) return;
    try {
      const title = (requirement.trim() || t('verifyConfig.empty.title')).slice(0, 60);
      // A rubric is a reusable snapshot, not another owner of the task's mutable
      // criterion rows. Clone the current definitions so later task edits cannot
      // silently rewrite this template or another task instantiated from it.
      const templateCriterionIds = await verifyService.createCriteria(
        toTemplateCriterionDrafts(drafts),
      );
      const rubric = await verifyService.createRubric({ title });
      await verifyService.setRubricCriteria(
        rubric.id,
        templateCriterionIds.map((criterionId) => ({ criterionId })),
      );
      toast.success(t('verifyConfig.saveAsTemplateSuccess'));
    } catch (e) {
      console.error('[TaskVerifyConfig] save as template failed:', e);
    }
  }, [drafts, verify?.verifyCriteriaIds, requirement, t]);

  const rubricOptions = useMemo(
    () => (rubrics ?? []).map((r) => ({ label: r.title, value: r.id })),
    [rubrics],
  );

  if (!taskId) return null;
  // The whole section is an editor surface; hide it when the user can't edit.
  if (!canEditTask) return null;

  const hasConfig = drafts.length > 0;

  // ---- Collapsed trigger (default): a "+" row; reveals the editor on click ----
  if (!expanded) {
    // A task may have verify configured via the natural-language requirement only
    // (config.verify.requirement) without ever materializing structured criteria.
    // Treat that as "configured" too, so the panel never reads as "never set".
    const requirementPreview = requirement.trim();
    const isConfigured = savedCount > 0 || requirementPreview.length > 0;
    // When the gate is a requirement sentence (no structured criteria), render the
    // requirement as flat body text BELOW the trigger — it's readable content, not
    // a clickable target. Only the compact title row stays clickable-to-expand, so
    // hovering the requirement doesn't light up a big clickable block.
    const showRequirement = savedCount === 0 && requirementPreview.length > 0;
    const trigger = (
      <Block
        clickable
        horizontal
        align={'center'}
        gap={8}
        paddingBlock={4}
        paddingInline={8}
        style={{ width: 'fit-content' }}
        variant={'borderless'}
        onClick={handleCollapsedClick}
      >
        <Icon
          color={cssVar.colorTextDescription}
          icon={isConfigured ? ShieldCheck : Plus}
          size={16}
        />
        <Text color={cssVar.colorTextSecondary} fontSize={13} weight={500}>
          {t('verifyConfig.empty.title')}
        </Text>
        {savedCount > 0 ? (
          <Tag>{t('verifyConfig.criteriaCount', { count: savedCount })}</Tag>
        ) : showRequirement ? null : (
          <Text className={styles.subtitle} fontSize={12}>
            {t('verifyConfig.collapsedHint')}
          </Text>
        )}
      </Block>
    );
    if (!showRequirement) return trigger;
    return (
      <Flexbox gap={2}>
        {trigger}
        <Text className={styles.collapsedRequirement} fontSize={14}>
          {requirementPreview}
        </Text>
      </Flexbox>
    );
  }

  // ---- B. generating ----
  if (generating) {
    return (
      <Block className={styles.section} variant={'outlined'}>
        <Flexbox horizontal align={'center'} gap={12}>
          <NeuralNetworkLoading size={20} />
          <Text className={styles.subtitle}>{t('verifyConfig.generating')}</Text>
        </Flexbox>
      </Block>
    );
  }

  // ---- A. empty ----
  if (!hasConfig) {
    // Secondary "add criteria" paths (manual / from template) collapse into a
    // single overflow menu so the empty state keeps one clear focus: the
    // requirement textarea. Both live in the header, not as body buttons.
    const addMenuItems: DropdownItem[] = [
      {
        icon: <Icon icon={Plus} />,
        key: 'manual-add',
        label: t('verifyConfig.manualAdd'),
        onClick: handleManualAdd,
      },
      {
        icon: <Icon icon={ChevronRight} />,
        key: 'from-template',
        label: t('verifyConfig.fromTemplate'),
        onClick: () => setShowTemplatePicker((v) => !v),
      },
    ];
    return (
      <Block className={styles.section} variant={'outlined'}>
        <Flexbox gap={12}>
          <Flexbox horizontal align={'center'} justify={'space-between'}>
            <Flexbox horizontal align={'center'} gap={8}>
              <Icon icon={ShieldCheck} size={18} />
              <Text weight={600}>{t('verifyConfig.empty.title')}</Text>
            </Flexbox>
            {/* Actions live top-right, de-emphasized, so they never outweigh the
                requirement input that is the empty state's primary focus. */}
            <Flexbox horizontal align={'center'} gap={4}>
              <Button
                disabled={!requirement.trim()}
                icon={Sparkles}
                size={'small'}
                onClick={handleGenerate}
              >
                {t('verifyConfig.generate')}
              </Button>
              <DropdownMenu items={addMenuItems} placement={'bottomRight'}>
                <ActionIcon icon={MoreHorizontal} size={'small'} />
              </DropdownMenu>
              <ActionIcon icon={ChevronUp} size={'small'} onClick={() => setExpanded(false)} />
            </Flexbox>
          </Flexbox>
          <Text className={styles.subtitle}>
            {requirement.trim()
              ? t('verifyConfig.empty.materializeHint')
              : t('verifyConfig.empty.subtitle')}
          </Text>
          <TextArea
            autoSize={{ maxRows: 4, minRows: 2 }}
            placeholder={t('verifyConfig.requirementPlaceholder')}
            value={requirement}
            onChange={(e) => handleRequirementChange(e.target.value)}
            onBlur={() => {
              const trimmed = requirement.trim();
              // A no-op blur (focus the field, click away) must NOT enable a gate:
              // an empty requirement with no criteria would persist
              // { enabled: true, requirement: null }, which the server reads as a
              // holistic "verify everything" gate while the collapsed UI still
              // looks unconfigured. Skip entirely when nothing is configured;
              // otherwise tie `enabled` to whether a real requirement exists, so
              // clearing the field disables the requirement-only gate.
              if (!trimmed && !verify?.requirement && savedCount === 0) return;
              commit(drafts, { enabled: trimmed.length > 0, requirement });
            }}
          />
          {showTemplatePicker ? (
            <Select
              options={rubricOptions}
              placeholder={t('verifyConfig.templatePlaceholder')}
              onChange={handlePickTemplate}
            />
          ) : null}
        </Flexbox>
      </Block>
    );
  }

  // ---- C. configured ----
  const requirementText = requirement.trim();

  // Reviewer contract: the configured header exposes ONE overflow trigger; enable,
  // regenerate, and remove all live inside it so the title row stays a single
  // affordance. There is no edit *mode* — every row edits itself through the
  // shared criterion modal, the same interaction goal creation uses.
  const headerMenuItems: DropdownItem[] = [
    {
      checked: enabled,
      key: 'enabled',
      label: t('verifyConfig.enable'),
      onCheckedChange: handleToggleEnabled,
      type: 'checkbox',
    },
    {
      disabled: !requirementText,
      icon: <Icon icon={RotateCcw} />,
      key: 'regenerate',
      label: t('verifyConfig.regenerate'),
      onClick: handleGenerate,
    },
    {
      disabled: !hydrated || (verify?.verifyCriteriaIds?.length ?? 0) === 0,
      key: 'save-as-template',
      label: t('verifyConfig.saveAsTemplate'),
      onClick: () => void handleSaveAsTemplate(),
    },
    { type: 'divider' },
    {
      danger: true,
      icon: <Icon icon={Trash} />,
      key: 'remove',
      label: t('taskDetail.acceptance.remove'),
      onClick: handleRemoveAll,
    },
  ];

  return (
    <Flexbox className={styles.section}>
      <Flexbox gap={12}>
        {/* Definition and result modes share one title contract. Mode-specific
            controls stay on the right without changing the information hierarchy. */}
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <TaskAcceptanceHeader isOpen count={drafts.length} onToggle={() => setExpanded(false)} />
          <DropdownMenu items={headerMenuItems} placement={'bottomRight'}>
            <ActionIcon
              icon={MoreHorizontal}
              size={'small'}
              title={t('verifyConfig.moreActions')}
            />
          </DropdownMenu>
        </Flexbox>

        <Flexbox gap={6}>
          <Text className={styles.subtitle} fontSize={12}>
            {t('taskDetail.acceptance.goal')}
          </Text>
          <Text type={requirementText ? undefined : 'secondary'}>
            {requirementText || t('verifyConfig.requirementEmpty')}
          </Text>
        </Flexbox>

        <CriterionList>
          {drafts.map((item, index) => (
            <CriterionRow
              key={item.id}
              seq={index + 1}
              title={item.title || t('verifyConfig.criterionTitlePlaceholder')}
              actions={
                // Edit and delete both fold into one per-row overflow, so the
                // row at rest shows a single quiet trigger.
                <DropdownMenu
                  placement={'bottomRight'}
                  items={[
                    {
                      icon: <Icon icon={Pencil} />,
                      key: 'edit',
                      label: t('verifyConfig.edit'),
                      onClick: () => openCriterionDetail(item),
                    },
                    {
                      danger: true,
                      icon: <Icon icon={Trash} />,
                      key: 'remove',
                      label: t('verifyConfig.removeCriterion'),
                      onClick: () => handleRemove(item.id),
                    },
                  ]}
                >
                  <ActionIcon
                    icon={MoreHorizontal}
                    size={'small'}
                    title={t('verifyConfig.moreActions')}
                    onClick={(event) => event.stopPropagation()}
                  />
                </DropdownMenu>
              }
              icon={
                <Icon
                  color={cssVar.colorTextQuaternary}
                  icon={CircleDashed}
                  size={16}
                  style={{ flex: 'none' }}
                />
              }
              onOpen={() => openCriterionDetail(item)}
            >
              {item.verifierType ? (
                <Tag>
                  {t(`criterion.verifierType.${item.verifierType}` as const, { ns: 'verify' })}
                </Tag>
              ) : null}
              <CriterionRequiredChip required={item.required !== false} />
            </CriterionRow>
          ))}
        </CriterionList>

        <Flexbox horizontal align={'center'} gap={8}>
          <Button icon={Plus} size={'small'} type={'text'} onClick={handleManualAdd}>
            {t('verifyConfig.addCriterion')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default TaskVerifyConfig;
