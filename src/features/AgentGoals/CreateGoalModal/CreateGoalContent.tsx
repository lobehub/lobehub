'use client';

import type { CreateGoalParams, GoalCriterionDraft } from '@lobechat/builtin-tool-task';
import { DEFAULT_GOAL_MAX_ROUNDS } from '@lobechat/const/verify';
import { useEditor } from '@lobehub/editor/react';
import { ActionIcon, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, toast, useModalContext } from '@lobehub/ui/base-ui';
import { InputNumber } from 'antd';
import { createGlobalStyle, createStaticStyles, cssVar } from 'antd-style';
import {
  ArrowLeft,
  Paperclip,
  Pencil,
  PencilLine,
  Plus,
  ShieldCheck,
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
import {
  CriterionList,
  CriterionRequiredChip,
  CriterionRow,
  openCriterionEditModal,
} from '@/features/Verify';
import { usePermission } from '@/hooks/usePermission';
import { verifyService } from '@/services/verify';
import { useTaskStore } from '@/store/task';

import { buildGoalTaskConfig } from './goalConfig';
import { createFallbackGoalCriterion, generateGoalCriteria } from './goalCriteria';
import { deriveGoalTitle } from './goalTitle';

const styles = createStaticStyles(({ css }) => ({
  budgetField: css`
    display: grid;
    grid-template-columns: 96px 144px minmax(0, 1fr);
    gap: 12px;
    align-items: center;

    min-width: 0;

    @media (width <= 640px) {
      grid-template-columns: minmax(0, 1fr);
      gap: 6px;
    }
  `,
  body: css`
    overflow-y: auto;

    min-height: 0;
    max-height: min(70vh, 680px);
    padding-block: 8px 24px;
    padding-inline: 16px;
  `,
  close: css`
    position: absolute;
    inset-block-start: 14px;
    inset-inline-end: 14px;
  `,
  criteriaList: css`
    overflow-y: auto;
    max-height: 320px;
  `,
  footer: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  head: css`
    position: relative;
    padding-block: 16px 8px;
    padding-inline: 16px;
  `,
  inputShell: css`
    position: relative;

    overflow: hidden;

    min-height: 208px;
    border-radius: 8px;

    background: ${cssVar.colorBgElevated};
  `,
  inputShellLoading: css`
    background: ${cssVar.colorBgElevated};

    &::after {
      pointer-events: none;
      content: '';

      position: absolute;
      z-index: 1;
      inset: 0;

      padding: 2px;
      border-radius: inherit;

      background: conic-gradient(
        from var(--goal-border-angle),
        ${cssVar.colorBorderSecondary} 0deg 210deg,
        #ff3d8d 238deg,
        #8b5cf6 258deg,
        #00c8ff 278deg,
        #22e6a8 298deg,
        #ffd43b 318deg,
        #ff6b35 338deg,
        ${cssVar.colorBorderSecondary} 360deg
      );

      mask:
        linear-gradient(#fff 0 0) content-box,
        linear-gradient(#fff 0 0);

      animation: goal-input-flow 1.8s linear infinite;

      mask-composite: exclude;
    }

    @keyframes goal-input-flow {
      from {
        --goal-border-angle: 0deg;
      }

      to {
        --goal-border-angle: 360deg;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      &::after {
        animation: none;
      }
    }
  `,
  instructionEditor: css`
    min-height: 36px;
    padding-block: 0 4px;
    padding-inline: 12px;

    /* EditorCanvas reserves space for its document footer by default. The
       compact review summary has no footer, so keeping that space turns a
       one-line instruction into a conspicuous empty band. */
    & > div > div > div {
      padding-block-end: 0 !important;
    }
  `,
  reviewSection: css`
    padding-block: 16px;

    &:first-child {
      padding-block: 0 4px;
    }
  `,
  sectionHint: css`
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    box-sizing: border-box;
    width: 100%;
    padding-block: 4px 8px;
    padding-inline-end: 40px;
    border: none;

    font-family: inherit;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.4;
    color: inherit;

    background: transparent;
    outline: none;
  `,
  titleStatic: css`
    padding-block: 4px 8px;
    padding-inline-end: 40px;

    font-size: 20px;
    font-weight: 600;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
}));

const GoalBorderFlowStyle = createGlobalStyle`
  @property --goal-border-angle {
    inherits: false;
    initial-value: 0deg;
    syntax: '<angle>';
  }
`;

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
  projectId?: string;
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
  const { agentId, initialRequirement, initialRoundBudget, initialTitle, onCreated, projectId } =
    props;
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

  const handleNext = useCallback(async () => {
    const instruction = instructionRef.current.trim() || plan.instruction.trim();
    if (!canCreate || !instruction) return;
    const name = plan.name.trim() || deriveGoalTitle(instruction);
    setPlan((current) => ({
      ...current,
      instruction,
      name,
    }));
    instructionRef.current = instruction;
    setStep('preparing');
    try {
      const generated = await generateGoalCriteria({
        context: name ? `Goal: ${name}` : undefined,
        goal: initialRequirement?.trim() || instruction,
      });
      setPlan((current) => ({
        ...current,
        criteria: generated,
      }));
      setStep('review');
    } catch (error) {
      console.error('[CreateGoalContent] generate failed:', error);
      setPlan((current) => ({
        ...current,
        criteria: [createFallbackGoalCriterion(instruction)],
        instruction,
        name: instruction,
      }));
      setStep('review');
      toast.warning(t('createGoal.generateFailed'));
    }
  }, [canCreate, initialRequirement, plan.instruction, plan.name, t]);

  const handleCreateBlank = useCallback(() => {
    if (!canCreate) return;
    const instruction = instructionRef.current.trim() || plan.instruction.trim();
    setPlan((current) => ({
      ...current,
      criteria:
        current.criteria.length > 0
          ? current.criteria
          : [{ onFail: 'auto_repair', required: true, title: '', verifierType: 'agent' }],
      instruction,
    }));
    instructionRef.current = instruction;
    setStep('review');
  }, [canCreate, plan.instruction]);

  const updateCriterion = useCallback((index: number, value: GoalCriterionDraft) => {
    setPlan((current) => ({
      ...current,
      criteria: current.criteria.map((criterion, criterionIndex) =>
        criterionIndex === index ? value : criterion,
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
    openCriterionEditModal({
      criterion: { onFail: 'auto_repair', required: true, title: '', verifierType: 'agent' },
      isNew: true,
      onSubmit: (criterion) =>
        setPlan((current) => ({ ...current, criteria: [...current.criteria, criterion] })),
    });
  }, []);

  const editCriterion = useCallback(
    (index: number) => {
      const criterion = plan.criteria[index];
      if (!criterion) return;
      openCriterionEditModal({
        criterion,
        onSubmit: (next) => updateCriterion(index, next),
      });
    },
    [plan.criteria, updateCriterion],
  );

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
      const { config, goal } = buildGoalTaskConfig({
        costBudget: plan.maxTotalCost,
        instruction,
        requirement,
        roundBudget: plan.maxIterations,
        verifyCriteriaIds,
      });
      const result = await createTask({
        assigneeAgentId: agentId,
        config,
        editorData,
        goal,
        instruction,
        name: plan.name.trim() || undefined,
        projectId,
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
    projectId,
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
    <Flexbox onKeyDown={handleKeyDown}>
      <GoalBorderFlowStyle />
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
            <input
              className={styles.title}
              disabled={!canCreate}
              placeholder={t('createGoal.titlePlaceholder')}
              value={plan.name}
              onChange={(e) => setPlan((current) => ({ ...current, name: e.target.value }))}
            />
          ) : (
            <div className={styles.titleStatic}>{t('createGoal.describeTitle')}</div>
          )}
          {step !== 'review' && (
            <>
              <div
                className={`${styles.inputShell} ${step === 'preparing' ? styles.inputShellLoading : ''}`}
              >
                <EditorCanvas
                  disabled={!canCreate || step === 'preparing'}
                  editor={editor}
                  editorData={{ content: plan.instruction }}
                  entityId={'create-goal-description'}
                  floatingToolbar={false}
                  placeholder={t('createGoal.instructionPlaceholder')}
                  style={{ fontSize: 14, minHeight: 206, padding: 16 }}
                  onContentChange={handleContentChange}
                />
              </div>
              <Text type={'secondary'}>{t('createGoal.describeHint')}</Text>
            </>
          )}
        </Flexbox>
        <ActionIcon className={styles.close} icon={X} onClick={close} />
      </Flexbox>

      {step === 'review' && (
        <Flexbox className={styles.body}>
          <Flexbox className={styles.reviewSection} gap={10}>
            <Flexbox className={styles.instructionEditor}>
              <EditorCanvas
                disabled={!canCreate}
                editor={editor}
                editorData={{ content: plan.instruction }}
                entityId={'create-goal-instruction'}
                floatingToolbar={false}
                placeholder={t('createGoal.instructionPlaceholder')}
                style={{ fontSize: 13, minHeight: 32 }}
                onContentChange={handleContentChange}
              />
            </Flexbox>
          </Flexbox>

          <Flexbox className={styles.reviewSection} gap={10}>
            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <Flexbox horizontal align={'center'} gap={8}>
                <Icon color={cssVar.colorTextTertiary} icon={ShieldCheck} size={16} />
                <Text fontSize={13} weight={600}>
                  {t('createGoal.criteriaTitle')}
                </Text>
                <Text className={styles.sectionHint} fontSize={12}>
                  {t('createGoal.criteriaHint')}
                </Text>
              </Flexbox>
              <Button icon={Plus} size={'small'} type={'text'} onClick={addCriterion}>
                {t('createGoal.addCriterion')}
              </Button>
            </Flexbox>
            {/* Draft rows keep the C{seq} anchor but no status icon — the pending
                circle belongs to the post-creation check list, not to authoring. */}
            <CriterionList className={styles.criteriaList}>
              {plan.criteria.map((criterion, index) => (
                <CriterionRow
                  key={index}
                  seq={index + 1}
                  title={criterion.title || t('createGoal.criterionPlaceholder')}
                  actions={
                    <>
                      <ActionIcon
                        icon={Pencil}
                        size={'small'}
                        onClick={(event) => {
                          event.stopPropagation();
                          editCriterion(index);
                        }}
                      />
                      <ActionIcon
                        icon={Trash2}
                        size={'small'}
                        title={t('createGoal.removeCriterion')}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeCriterion(index);
                        }}
                      />
                    </>
                  }
                  onOpen={() => editCriterion(index)}
                >
                  <CriterionRequiredChip
                    required={criterion.required ?? true}
                    onToggle={() =>
                      updateCriterion(index, {
                        ...criterion,
                        required: !(criterion.required ?? true),
                      })
                    }
                  />
                </CriterionRow>
              ))}
            </CriterionList>
          </Flexbox>

          <Flexbox className={styles.reviewSection} gap={10}>
            <Text fontSize={13} weight={600}>
              {t('createGoal.budgetTitle')}
            </Text>
            <Flexbox gap={12}>
              <div className={styles.budgetField}>
                <Text fontSize={12} type={'secondary'}>
                  {t('createGoal.roundBudgetLabel')}
                </Text>
                <InputNumber
                  disabled={!canCreate}
                  min={2}
                  size={'small'}
                  style={{ width: '100%' }}
                  value={plan.maxIterations ?? undefined}
                  variant={'filled'}
                  suffix={
                    <Text fontSize={12} type={'secondary'}>
                      {t('createGoal.roundsUnit')}
                    </Text>
                  }
                  onChange={(value) => setPlan((current) => ({ ...current, maxIterations: value }))}
                />
                <Text className={styles.sectionHint} fontSize={12}>
                  {t('createGoal.roundBudgetHint')}
                </Text>
              </div>

              <div className={styles.budgetField}>
                <Text fontSize={12} type={'secondary'}>
                  {t('createGoal.costBudgetLabel')}
                </Text>
                <InputNumber
                  controls={false}
                  disabled={!canCreate}
                  min={0}
                  placeholder={t('createGoal.costBudgetPlaceholder')}
                  size={'small'}
                  style={{ width: '100%' }}
                  value={plan.maxTotalCost}
                  variant={'filled'}
                  prefix={
                    <Text fontSize={12} type={'secondary'}>
                      $
                    </Text>
                  }
                  onChange={(value) => setPlan((current) => ({ ...current, maxTotalCost: value }))}
                />
                <Text className={styles.sectionHint} fontSize={12}>
                  {t('createGoal.costBudgetHint')}
                </Text>
              </div>
            </Flexbox>
          </Flexbox>
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

        <Flexbox horizontal align={'center'} gap={4}>
          {step === 'describe' && (
            <Button
              disabled={!canCreate || isCreating}
              icon={PencilLine}
              size={'small'}
              style={{ color: cssVar.colorTextTertiary }}
              title={canCreate ? undefined : reason}
              type={'text'}
              onClick={handleCreateBlank}
            >
              {t('createModal.createBlank')}
            </Button>
          )}
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
              (step === 'describe'
                ? !plan.instruction.trim()
                : !plan.name.trim() || plan.criteria.every((criterion) => !criterion.title.trim()))
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
    </Flexbox>
  );
});

CreateGoalContent.displayName = 'CreateGoalContent';

export default CreateGoalContent;
