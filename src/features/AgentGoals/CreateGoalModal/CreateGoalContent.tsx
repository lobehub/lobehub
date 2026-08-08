'use client';

import type { CreateGoalParams, GoalCriterionDraft } from '@lobechat/builtin-tool-task';
import { DEFAULT_GOAL_MAX_ROUNDS } from '@lobechat/const/verify';
import { useEditor } from '@lobehub/editor/react';
import { ActionIcon, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { Button, toast, useModalContext } from '@lobehub/ui/base-ui';
import { InputNumber } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ArrowLeft,
  CheckCircle2,
  CircleDollarSign,
  Paperclip,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import TaskVisibilityChipLabel from '@/features/AgentTasks/features/TaskVisibilityChipLabel';
import TaskVisibilityTag from '@/features/AgentTasks/features/TaskVisibilityTag';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { useAgentVisibility } from '@/features/AgentTasks/shared/useAgentVisibility';
import { EditorCanvas } from '@/features/EditorCanvas';
import { pickAndInsertAttachments } from '@/features/EditorCanvas/editorAttachments';
import { usePermission } from '@/hooks/usePermission';
import { verifyService } from '@/services/verify';
import { useTaskStore } from '@/store/task';

import { buildGoalTaskConfig } from './goalConfig';

const styles = createStaticStyles(({ css }) => ({
  budgetCard: css`
    min-width: 0;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillQuaternary};
  `,
  budgetGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;

    @media (width <= 640px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  body: css`
    overflow-y: auto;
    min-height: 0;
    padding-block: 8px 24px;
    padding-inline: 24px;
  `,
  criteriaList: css`
    overflow-y: auto;
    max-height: 240px;
  `,
  criterion: css`
    padding-block: 8px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgElevated};
  `,
  criterionIndex: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border-radius: ${cssVar.borderRadiusSM};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  footer: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  head: css`
    padding-block: 16px 8px;
    padding-inline: 24px;
  `,
  inputShell: css`
    padding: 1px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgElevated};
  `,
  inputShellLoading: css`
    border-color: transparent;
    background: linear-gradient(
      90deg,
      ${cssVar.colorPrimary},
      ${cssVar.colorInfo},
      ${cssVar.colorSuccess},
      ${cssVar.colorPrimary}
    );
    background-size: 300% 100%;
    animation: goal-input-flow 1.4s linear infinite;

    @keyframes goal-input-flow {
      from {
        background-position: 0% 50%;
      }

      to {
        background-position: 150% 50%;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
  section: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  sectionIcon: css`
    flex: none;
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    width: 100%;
    padding-block: 4px;
    border: none;

    font-family: inherit;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.4;
    color: inherit;

    background: transparent;
    outline: none;
  `,
  titleDescribe: css`
    padding-block: 10px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgElevated};
  `,
}));

const criterionRequirement = (drafts: GoalCriterionDraft[]) =>
  drafts
    .map((draft) => draft.title.trim())
    .filter(Boolean)
    .map((title) => `- ${title}`)
    .join('\n');

export interface CreateGoalContentProps {
  /** The agent that owns the goal. Goals are always agent-scoped. */
  agentId?: string;
  /** Seed from an empty-state example. Only the plain fields — the instruction
   *  body falls back to the title, so the editor is never fought over. */
  initialRequirement?: string;
  initialRoundBudget?: number;
  initialTitle?: string;
  onCreated?: (goal: { agentId?: string; identifier: string }) => void;
}

/**
 * Create a goal — deliberately *not* the task modal with a flag.
 *
 * A goal commits the user to something a task never does: a standing acceptance
 * bar and a budget of autonomous rounds spent against it. Both were previously
 * invisible (the acceptance silently reused the instruction, the budget was
 * hardcoded), so this form asks for them outright.
 */
const CreateGoalContent = memo<CreateGoalContentProps>((props) => {
  const { agentId, initialRequirement, initialRoundBudget, initialTitle, onCreated } = props;
  const { t } = useTranslation('chat');
  const { close } = useModalContext();
  const { allowed: canCreate, reason } = usePermission('create_content');

  const createTask = useTaskStore((s) => s.createTask);
  const isCreating = useTaskStore((s) => s.isCreatingTask);
  const activeWorkspaceId = useActiveWorkspaceId();

  const [step, setStep] = useState<'describe' | 'preparing' | 'review'>('describe');
  const [plan, setPlan] = useState<CreateGoalParams>({
    criteria: [],
    instruction: initialRequirement ?? initialTitle ?? '',
    maxIterations: initialRoundBudget ?? DEFAULT_GOAL_MAX_ROUNDS,
    maxTotalCost: null,
    name: initialTitle ?? '',
  });
  // Default to private in workspace mode so sharing is opt-in; personal mode
  // ignores the field and hides the chip.
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');

  // A private agent can only run a private task, goals included.
  const isPrivateAgent = useAgentVisibility(agentId) === 'private';
  useEffect(() => {
    if (isPrivateAgent && visibility === 'public') setVisibility('private');
  }, [isPrivateAgent, visibility]);

  const editor = useEditor();
  const prepareTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  useEffect(
    () => () => {
      if (prepareTimerRef.current) clearTimeout(prepareTimerRef.current);
    },
    [],
  );
  const instructionRef = useRef(plan.instruction);
  const assigneeMeta = useAgentDisplayMeta(agentId);
  const requirement = useMemo(() => criterionRequirement(plan.criteria), [plan.criteria]);

  const handleContentChange = useCallback(() => {
    if (!canCreate || !editor) return;
    instructionRef.current = String(editor.getDocument('markdown') ?? '');
    setPlan((current) => ({ ...current, instruction: instructionRef.current }));
  }, [canCreate, editor]);

  const handleAttach = useCallback(() => {
    pickAndInsertAttachments(editor);
  }, [editor]);

  const handleNext = useCallback(() => {
    if (!canCreate || !plan.name.trim()) return;
    const seededCriterion = initialRequirement?.trim();
    setPlan((current) => ({
      ...current,
      criteria:
        current.criteria.length > 0
          ? current.criteria
          : [
              {
                onFail: 'auto_repair',
                required: true,
                title: seededCriterion ?? '',
                verifierType: 'agent',
              },
            ],
      instruction: current.instruction.trim() || current.name.trim(),
    }));
    instructionRef.current = plan.instruction.trim() || plan.name.trim();
    setStep('preparing');
    prepareTimerRef.current = setTimeout(() => setStep('review'), 700);
  }, [canCreate, initialRequirement, plan.instruction, plan.name]);

  const updateCriterion = useCallback((index: number, value: string) => {
    setPlan((current) => ({
      ...current,
      criteria: current.criteria.map((criterion, criterionIndex) =>
        criterionIndex === index ? { ...criterion, title: value } : criterion,
      ),
    }));
  }, []);

  const removeCriterion = useCallback((index: number) => {
    setPlan((current) => ({
      ...current,
      criteria: current.criteria.filter((_, criterionIndex) => criterionIndex !== index),
    }));
  }, []);

  const addCriterion = useCallback(() => {
    setPlan((current) => ({
      ...current,
      criteria: [
        ...current.criteria,
        { onFail: 'auto_repair', required: true, title: '', verifierType: 'agent' },
      ],
    }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canCreate) return;
    const instruction =
      instructionRef.current.trim() || plan.instruction.trim() || plan.name.trim();
    const editorData = instructionRef.current.trim()
      ? (editor?.getDocument?.('json') as unknown)
      : undefined;
    const reviewedCriteria = plan.criteria.filter((criterion) => criterion.title.trim());
    if (!instruction || reviewedCriteria.length === 0) return;

    let verifyCriteriaIds: string[] = [];
    try {
      verifyCriteriaIds = await verifyService.createCriteria(reviewedCriteria);
      const result = await createTask({
        assigneeAgentId: agentId,
        config: buildGoalTaskConfig({
          costBudget: plan.maxTotalCost,
          instruction,
          requirement,
          roundBudget: plan.maxIterations,
          verifyCriteriaIds,
        }),
        editorData,
        instruction,
        name: plan.name.trim() || undefined,
        visibility: activeWorkspaceId ? visibility : undefined,
      });

      if (!result) throw new Error('The goal was not created.');

      close();
      onCreated?.({
        agentId: result.assigneeAgentId ?? undefined,
        identifier: result.identifier,
      });
    } catch (error) {
      console.error('[CreateGoalContent] create failed:', error);
      await Promise.allSettled(verifyCriteriaIds.map((id) => verifyService.deleteCriterion(id)));
      toast.error(t('createGoal.createFailed'));
    }
  }, [
    activeWorkspaceId,
    agentId,
    canCreate,
    close,
    createTask,
    editor,
    onCreated,
    plan,
    requirement,
    t,
    visibility,
  ]);

  const handlePrimaryAction =
    step === 'describe' ? handleNext : step === 'review' ? handleSubmit : undefined;
  const handleSubmitRef = useRef(handlePrimaryAction);
  useEffect(() => {
    handleSubmitRef.current = handlePrimaryAction;
  }, [handlePrimaryAction]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      void handleSubmitRef.current?.();
    }
  }, []);

  return (
    <Flexbox height={step === 'review' ? 'min(86vh, 800px)' : undefined} onKeyDown={handleKeyDown}>
      <Flexbox horizontal className={styles.head}>
        <Flexbox flex={1} gap={6}>
          {step === 'review' && (
            <Flexbox horizontal align={'center'} gap={8}>
              <ActionIcon
                icon={ArrowLeft}
                size={'small'}
                title={t('createGoal.back')}
                onClick={() => setStep('describe')}
              />
              <Text fontSize={12} type={'secondary'}>
                {t('createGoal.reviewStep')}
              </Text>
            </Flexbox>
          )}
          {step === 'review' ? (
            <Text fontSize={20} weight={600}>
              {plan.name}
            </Text>
          ) : (
            <div
              className={`${styles.inputShell} ${step === 'preparing' ? styles.inputShellLoading : ''}`}
            >
              <input
                autoFocus={canCreate}
                className={`${styles.title} ${styles.titleDescribe}`}
                disabled={!canCreate || step === 'preparing'}
                placeholder={t('createGoal.titlePlaceholder')}
                value={plan.name}
                onChange={(e) => setPlan((current) => ({ ...current, name: e.target.value }))}
              />
            </div>
          )}
          {step !== 'review' && <Text type={'secondary'}>{t('createGoal.describeHint')}</Text>}
        </Flexbox>
        <ActionIcon icon={X} style={{ flexShrink: 0 }} onClick={close} />
      </Flexbox>

      {step === 'review' && (
        <Flexbox className={styles.body} flex={1} gap={12}>
          <Flexbox className={styles.section} gap={12}>
            <Flexbox horizontal align={'flex-start'} gap={10}>
              <Icon className={styles.sectionIcon} icon={Paperclip} size={18} />
              <Flexbox gap={2}>
                <Text fontSize={14} weight={600}>
                  {t('createGoal.contextLabel')}
                </Text>
                <Text fontSize={12} type={'secondary'}>
                  {t('createGoal.contextHint')}
                </Text>
              </Flexbox>
            </Flexbox>
            <EditorCanvas
              disabled={!canCreate}
              editor={editor}
              editorData={{ content: plan.instruction }}
              entityId={'create-goal-instruction'}
              floatingToolbar={false}
              placeholder={t('createGoal.instructionPlaceholder')}
              style={{ fontSize: 14, minHeight: 120 }}
              onContentChange={handleContentChange}
            />
          </Flexbox>

          <Flexbox className={styles.section} gap={12}>
            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <Flexbox horizontal align={'flex-start'} gap={10}>
                <Icon className={styles.sectionIcon} icon={CheckCircle2} size={18} />
                <Flexbox gap={2}>
                  <Text fontSize={14} weight={600}>
                    {t('createGoal.criteriaTitle')}
                  </Text>
                  <Text fontSize={12} type={'secondary'}>
                    {t('createGoal.criteriaHint')}
                  </Text>
                </Flexbox>
              </Flexbox>
              <Button icon={Plus} size={'small'} type={'text'} onClick={addCriterion}>
                {t('createGoal.addCriterion')}
              </Button>
            </Flexbox>
            <Flexbox className={styles.criteriaList} gap={8}>
              {plan.criteria.map((criterion, index) => (
                <Flexbox
                  horizontal
                  align={'center'}
                  className={styles.criterion}
                  gap={8}
                  key={index}
                >
                  <span className={styles.criterionIndex}>C{index + 1}</span>
                  <Input
                    disabled={!canCreate}
                    placeholder={t('createGoal.criterionPlaceholder')}
                    value={criterion.title}
                    variant={'borderless'}
                    onChange={(e) => updateCriterion(index, e.target.value)}
                  />
                  <ActionIcon
                    icon={Trash2}
                    size={'small'}
                    title={t('createGoal.removeCriterion')}
                    onClick={() => removeCriterion(index)}
                  />
                </Flexbox>
              ))}
            </Flexbox>
          </Flexbox>

          <div className={styles.budgetGrid}>
            <Flexbox className={styles.budgetCard} gap={12}>
              <Flexbox horizontal align={'center'} gap={8}>
                <Icon className={styles.sectionIcon} icon={RotateCcw} size={16} />
                <Text fontSize={14} weight={600}>
                  {t('createGoal.roundBudgetLabel')}
                </Text>
              </Flexbox>
              <InputNumber
                disabled={!canCreate}
                min={2}
                suffix={t('createGoal.roundsUnit')}
                value={plan.maxIterations ?? undefined}
                variant={'filled'}
                onChange={(value) => setPlan((current) => ({ ...current, maxIterations: value }))}
              />
              <Text fontSize={12} type={'secondary'}>
                {t('createGoal.roundBudgetHint')}
              </Text>
            </Flexbox>

            <Flexbox className={styles.budgetCard} gap={12}>
              <Flexbox horizontal align={'center'} gap={8}>
                <Icon className={styles.sectionIcon} icon={CircleDollarSign} size={16} />
                <Text fontSize={14} weight={600}>
                  {t('createGoal.costBudgetLabel')}
                </Text>
              </Flexbox>
              <InputNumber
                controls={false}
                disabled={!canCreate}
                min={0}
                placeholder={t('createGoal.costBudgetPlaceholder')}
                prefix={'$'}
                value={plan.maxTotalCost}
                variant={'filled'}
                onChange={(value) => setPlan((current) => ({ ...current, maxTotalCost: value }))}
              />
              <Text fontSize={12} type={'secondary'}>
                {t('createGoal.costBudgetHint')}
              </Text>
            </Flexbox>
          </div>
        </Flexbox>
      )}

      <Flexbox horizontal align={'center'} className={styles.footer} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <Flexbox horizontal align={'center'} gap={6}>
            <AssigneeAvatar agentId={agentId} size={18} />
            <Text fontSize={12}>{assigneeMeta?.title}</Text>
          </Flexbox>
          {activeWorkspaceId && (
            <TaskVisibilityTag
              visibility={visibility}
              lockedReason={
                isPrivateAgent ? t('createTask.visibility.privateAgentLocked') : undefined
              }
              onChange={setVisibility}
            >
              <TaskVisibilityChipLabel visibility={visibility} />
            </TaskVisibilityTag>
          )}
          {step === 'review' && (
            <ActionIcon
              icon={Paperclip}
              title={t('upload.action.tooltip')}
              onClick={handleAttach}
            />
          )}
        </Flexbox>

        <Button
          loading={isCreating || step === 'preparing'}
          shape={'round'}
          size={'small'}
          title={canCreate ? undefined : reason}
          type={'primary'}
          disabled={
            !canCreate ||
            isCreating ||
            step === 'preparing' ||
            !plan.name.trim() ||
            (step === 'review' && plan.criteria.every((criterion) => !criterion.title.trim()))
          }
          onClick={step === 'describe' ? handleNext : handleSubmit}
        >
          {step === 'preparing'
            ? t('createGoal.preparing')
            : step === 'describe'
              ? t('createGoal.next')
              : t('createGoal.submit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

CreateGoalContent.displayName = 'CreateGoalContent';

export default CreateGoalContent;
