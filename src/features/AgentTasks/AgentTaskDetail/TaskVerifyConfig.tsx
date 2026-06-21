'use client';

import {
  ActionIcon,
  Block,
  Button,
  Flexbox,
  Icon,
  Input,
  Select,
  SortableList,
  Tag,
  Text,
  TextArea,
} from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ChevronUp, Plus, RotateCcw, ShieldCheck, Sparkles, Trash } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useRubrics } from '@/features/Verify/hooks';
import { usePermission } from '@/hooks/usePermission';
import { type VerifyCriterionDraft, verifyService } from '@/services/verify';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const SAVE_DEBOUNCE_MS = 600;

const styles = createStaticStyles(({ css, cssVar }) => ({
  list: css`
    width: 100%;
  `,
  row: css`
    padding-block: 8px;
    padding-inline: 8px;
  `,
  rowTitle: css`
    flex: 1;
  `,
  section: css`
    padding: 16px;
    border-radius: 12px;
  `,
  subtitle: css`
    color: ${cssVar.colorTextSecondary};
  `,
  trigger: css`
    cursor: pointer;
    width: fit-content;
    border-radius: 8px;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

/** Working item: a draft plus a stable client id, so reorder/edit is jitter-free. */
interface DraftItem extends VerifyCriterionDraft {
  /** Stable client-side id for list keys + dnd; not the persisted criterion id. */
  id: string;
}

let idSeq = 0;
const nextUid = () => `vc_${Date.now().toString(36)}_${(idSeq += 1)}`;

const toDraftItem = (draft: VerifyCriterionDraft): DraftItem => ({ ...draft, id: nextUid() });

const TaskVerifyConfig = memo(() => {
  const { t } = useTranslation('chat');
  const { message } = App.useApp();
  const { allowed: canEditTask } = usePermission('create_content');
  const enableTaskVerify = useUserStore(labPreferSelectors.enableTaskVerify);

  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
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
  useEffect(() => {
    if (!taskId) return;
    if (hydratedTaskRef.current === taskId) return;
    hydratedTaskRef.current = taskId;
    setRequirement(verify?.requirement ?? '');
    setEnabled(verify?.enabled !== false);
    setShowTemplatePicker(false);

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
            toDraftItem({
              description: c.description ?? undefined,
              documentId: c.documentId,
              required: c.required,
              title: c.title,
              verifierConfig: c.verifierConfig ?? undefined,
              verifierType: c.verifierType,
            }),
          );
        setDrafts(ordered);
      })
      .finally(() => setHydrated(true));
  }, [taskId, verify?.verifyCriteriaIds, verify?.requirement, verify?.enabled]);

  // ---- debounced persistence ----
  // v1 simplification: every save re-creates fresh criterion rows (full replace).
  // We deliberately do NOT diff/dedupe against existing criteria — order of the
  // returned ids is the display order, which keeps drag-reorder trivially correct.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Latest not-yet-flushed payload; the debounce timer (or unmount flush) reads it.
  const pendingRef = useRef<{
    drafts: DraftItem[];
    enabled: boolean;
    requirement: string;
  } | null>(null);

  const doSave = useCallback(async () => {
    const payload = pendingRef.current;
    pendingRef.current = null;
    if (!taskId || !payload) return;
    try {
      const cleaned = payload.drafts.filter((d) => d.title.trim().length > 0);
      const requirement = payload.requirement.trim() || null;
      if (cleaned.length === 0) {
        // Removing all criteria clears the gate → back to the empty state.
        await useTaskStore.getState().updateVerifyConfig(taskId, {
          enabled: payload.enabled,
          requirement,
          verifyCriteriaIds: null,
        });
        return;
      }
      const ids = await verifyService.createCriteria(
        cleaned.map(({ id: _id, ...draft }) => ({ ...draft, title: draft.title.trim() })),
      );
      await useTaskStore.getState().updateVerifyConfig(taskId, {
        enabled: payload.enabled,
        requirement,
        verifyCriteriaIds: ids,
      });
    } catch (e) {
      console.error('[TaskVerifyConfig] Failed to save:', e);
    }
  }, [taskId]);

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
  const handleGenerate = useCallback(async () => {
    const goal = requirement.trim();
    if (!goal || generating || !model || !provider) return;
    setGenerating(true);
    try {
      const generated = await verifyService.generateCriteria({
        goal,
        modelConfig: { model, provider },
      });
      const items = generated.map((d) => toDraftItem(d));
      commit(items);
    } catch (e) {
      console.error('[TaskVerifyConfig] generate failed:', e);
      message.error(t('verifyConfig.generateFailed'));
    } finally {
      setGenerating(false);
    }
  }, [requirement, generating, model, provider, commit, message, t]);

  const handleManualAdd = useCallback(() => {
    commit([...drafts, toDraftItem({ required: true, title: '', verifierType: 'llm' })]);
  }, [drafts, commit]);

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

  const handleTitleChange = useCallback(
    (id: string, title: string) => {
      commit(drafts.map((d) => (d.id === id ? { ...d, title } : d)));
    },
    [drafts, commit],
  );

  const handleToggleRequired = useCallback(
    (id: string, required: boolean) => {
      commit(drafts.map((d) => (d.id === id ? { ...d, required } : d)));
    },
    [drafts, commit],
  );

  const handleRemove = useCallback(
    (id: string) => {
      commit(drafts.filter((d) => d.id !== id));
    },
    [drafts, commit],
  );

  const handleSortEnd = useCallback(
    (items: DraftItem[]) => {
      commit(items);
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
      const rubric = await verifyService.createRubric({ title });
      await verifyService.setRubricCriteria(
        rubric.id,
        persistedIds.map((criterionId) => ({ criterionId })),
      );
      message.success(t('verifyConfig.saveAsTemplateSuccess'));
    } catch (e) {
      console.error('[TaskVerifyConfig] save as template failed:', e);
    }
  }, [verify?.verifyCriteriaIds, requirement, t, message]);

  const rubricOptions = useMemo(
    () => (rubrics ?? []).map((r) => ({ label: r.title, value: r.id })),
    [rubrics],
  );

  if (!taskId) return null;
  // Gated behind the Labs "task verify" experimental toggle (off by default).
  if (!enableTaskVerify) return null;
  // The whole section is an editor surface; hide it when the user can't edit.
  if (!canEditTask) return null;

  const hasConfig = drafts.length > 0;
  const savedCount = verify?.verifyCriteriaIds?.length ?? 0;

  // ---- Collapsed trigger (default): a "+" row; reveals the editor on click ----
  if (!expanded) {
    return (
      <Block
        clickable
        horizontal
        align={'center'}
        className={styles.trigger}
        gap={8}
        paddingBlock={8}
        paddingInline={12}
        variant={'outlined'}
        onClick={() => setExpanded(true)}
      >
        <Icon icon={savedCount > 0 ? ShieldCheck : Plus} size={16} />
        <Text weight={500}>{t('verifyConfig.empty.title')}</Text>
        {savedCount > 0 ? (
          <Tag>{t('verifyConfig.criteriaCount', { count: savedCount })}</Tag>
        ) : (
          <Text className={styles.subtitle} fontSize={12}>
            {t('verifyConfig.collapsedHint')}
          </Text>
        )}
      </Block>
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
    return (
      <Block className={styles.section} variant={'outlined'}>
        <Flexbox gap={12}>
          <Flexbox horizontal align={'center'} justify={'space-between'}>
            <Flexbox horizontal align={'center'} gap={8}>
              <Icon icon={ShieldCheck} size={18} />
              <Text weight={600}>{t('verifyConfig.empty.title')}</Text>
            </Flexbox>
            <ActionIcon icon={ChevronUp} size={'small'} onClick={() => setExpanded(false)} />
          </Flexbox>
          <Text className={styles.subtitle}>{t('verifyConfig.empty.subtitle')}</Text>
          <TextArea
            autoSize={{ maxRows: 4, minRows: 2 }}
            placeholder={t('verifyConfig.requirementPlaceholder')}
            value={requirement}
            onChange={(e) => handleRequirementChange(e.target.value)}
          />
          <Flexbox horizontal align={'center'} gap={8}>
            <Button
              disabled={!requirement.trim()}
              icon={Sparkles}
              type={'primary'}
              onClick={handleGenerate}
            >
              {t('verifyConfig.generate')}
            </Button>
            <Button size={'small'} type={'text'} onClick={handleManualAdd}>
              {t('verifyConfig.manualAdd')}
            </Button>
            <Button size={'small'} type={'text'} onClick={() => setShowTemplatePicker((v) => !v)}>
              {t('verifyConfig.fromTemplate')}
            </Button>
          </Flexbox>
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
  return (
    <Block className={styles.section} variant={'outlined'}>
      <Flexbox gap={12}>
        {/* header: title + enable */}
        <Flexbox horizontal align={'center'} justify={'space-between'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Icon icon={ShieldCheck} size={18} />
            <Text weight={600}>{t('verifyConfig.empty.title')}</Text>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={8}>
            <Switch checked={enabled} onChange={handleToggleEnabled} />
            <ActionIcon icon={ChevronUp} size={'small'} onClick={() => setExpanded(false)} />
          </Flexbox>
        </Flexbox>

        {/* requirement sentence + regenerate */}
        <Flexbox gap={6}>
          <Flexbox horizontal align={'center'} justify={'space-between'}>
            <Text className={styles.subtitle} fontSize={12}>
              {t('verifyConfig.requirementLabel')}
            </Text>
            <Button
              disabled={!requirement.trim()}
              icon={RotateCcw}
              size={'small'}
              type={'text'}
              onClick={handleGenerate}
            >
              {t('verifyConfig.regenerate')}
            </Button>
          </Flexbox>
          <TextArea
            autoSize={{ maxRows: 4, minRows: 1 }}
            placeholder={t('verifyConfig.requirementPlaceholder')}
            value={requirement}
            onBlur={() => commit(drafts, { requirement })}
            onChange={(e) => handleRequirementChange(e.target.value)}
          />
        </Flexbox>

        {/* criteria list (drag-reorderable) */}
        <SortableList
          className={styles.list}
          items={drafts}
          renderItem={(item: DraftItem) => (
            <SortableList.Item className={styles.row} id={item.id} variant={'filled'}>
              <SortableList.DragHandle />
              <Input
                className={styles.rowTitle}
                placeholder={t('verifyConfig.criterionTitlePlaceholder')}
                value={item.title}
                variant={'borderless'}
                onChange={(e) => handleTitleChange(item.id, e.target.value)}
              />
              {item.verifierType ? (
                <Tag>{t(`verifyConfig.verifierType.${item.verifierType}` as const)}</Tag>
              ) : null}
              <Flexbox horizontal align={'center'} gap={6}>
                <Text className={styles.subtitle} fontSize={12}>
                  {t('verifyConfig.required')}
                </Text>
                <Switch
                  checked={item.required !== false}
                  onChange={(checked) => handleToggleRequired(item.id, checked)}
                />
              </Flexbox>
              <ActionIcon
                icon={Trash}
                size={'small'}
                title={t('verifyConfig.removeCriterion')}
                onClick={() => handleRemove(item.id)}
              />
            </SortableList.Item>
          )}
          onChange={handleSortEnd}
        />

        {/* footer actions */}
        <Flexbox horizontal align={'center'} gap={8}>
          <Button icon={Plus} size={'small'} type={'text'} onClick={handleManualAdd}>
            {t('verifyConfig.addCriterion')}
          </Button>
          <Button
            disabled={!hydrated || (verify?.verifyCriteriaIds?.length ?? 0) === 0}
            size={'small'}
            type={'text'}
            onClick={handleSaveAsTemplate}
          >
            {t('verifyConfig.saveAsTemplate')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Block>
  );
});

export default TaskVerifyConfig;
