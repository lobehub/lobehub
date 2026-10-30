'use client';

import { resolveGoalAttemptBudget } from '@lobechat/builtin-tool-goal';
import type { CreateGoalParams, GoalCriterionDraft } from '@lobechat/builtin-tool-task';
import { DEFAULT_GOAL_MAX_ROUNDS } from '@lobechat/const/verify';
import { useEditor } from '@lobehub/editor/react';
import {
  ActionIcon,
  Button,
  confirmModal,
  Flexbox,
  Icon,
  InputNumber,
  Spin,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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
import { type KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import GeneratingBorder from '@/components/GeneratingBorder';
import {
  CriterionList,
  CriterionRequiredChip,
  CriterionRow,
  openCriterionEditModal,
} from '@/features/Acceptance';
import { useEscapeDiscardGuard } from '@/features/AgentTasks/shared/useEscapeDiscardGuard';
import { EditorCanvas } from '@/features/EditorCanvas';
import { pickAndInsertAttachments } from '@/features/EditorCanvas/editorAttachments';
import { usePermission } from '@/hooks/usePermission';
import { goalService } from '@/services/goal';
import { shinyTextStyles } from '@/styles';
import { sx } from '@/styles/sx';

import GoalAgentPill from '../GoalAgentPill';
import moduleStyles from './CreateGoalContent.module.css';
import { buildGoalAgents, buildGoalCreateInput, buildReviewedGoalContent } from './goalConfig';
import { createFallbackGoalCriterion, generateGoalCriteria } from './goalCriteria';
import { deriveGoalTitle } from './goalTitle';
import { hasUnsavedGoalDraft } from './hasUnsavedGoalDraft';

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

const generationRoll = stylex.keyframes({
  '0%, 20%': { transform: 'translateY(0)' },
  '25%, 45%': { transform: 'translateY(-22px)' },
  '50%, 70%': { transform: 'translateY(-44px)' },
  '75%, 95%': { transform: 'translateY(-66px)' },
  '100%': { transform: 'translateY(-88px)' },
});

const styles = stylex.create({
  budgetField: {
    display: 'grid',
    gridTemplateColumns: {
      'default': '96px 144px minmax(0, 1fr)',
      '@media (width <= 640px)': 'minmax(0, 1fr)',
    },
    gap: { 'default': '12px', '@media (width <= 640px)': '6px' },
    alignItems: 'center',
    minWidth: 0,
  },
  body: {
    overflowY: 'auto',
    minHeight: 0,
    maxHeight: 'min(70vh, 680px)',
    paddingBlockStart: '8px',
    paddingBlockEnd: '24px',
    paddingInline: '16px',
  },
  close: {
    position: 'absolute',
    insetBlockStart: '14px',
    insetInlineEnd: '14px',
  },
  criteriaList: { overflowY: 'auto', maxHeight: '320px' },
  footer: {
    flexShrink: 0,
    paddingBlock: '8px',
    paddingInline: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  generatingStatus: {
    minHeight: '36px',
    paddingBlock: '6px',
    color: cssVar.colorTextSecondary,
  },
  generatingTextItem: {
    display: 'flex',
    alignItems: 'center',
    height: '22px',
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: '22px',
    whiteSpace: 'nowrap',
  },
  generatingTextTrack: {
    animationName: { default: generationRoll, [REDUCED_MOTION]: 'none' },
    animationDuration: '16s',
    animationTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    animationIterationCount: 'infinite',
  },
  generatingTextViewport: { overflow: 'hidden', height: '22px' },
  head: {
    minHeight: 0,
    position: 'relative',
    paddingBlockStart: '16px',
    paddingBlockEnd: '8px',
    paddingInline: '16px',
  },
  inputScroller: { overflowY: 'auto', flex: '1', minHeight: 0 },
  inputShell: {
    overflow: 'hidden',
    minHeight: '208px',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  instructionEditor: {
    minHeight: '36px',
    paddingBlockStart: 0,
    paddingBlockEnd: '4px',
    paddingInline: '12px',
  },
  reviewSection: {
    paddingBlockStart: { 'default': '16px', ':first-child': 0 },
    paddingBlockEnd: { 'default': '16px', ':first-child': '4px' },
  },
  sectionHint: { color: cssVar.colorTextSecondary },
  title: {
    boxSizing: 'border-box',
    width: '100%',
    paddingBlockStart: '4px',
    paddingBlockEnd: '8px',
    paddingInlineEnd: '40px',
    borderStyle: 'none',
    fontFamily: 'inherit',
    fontSize: '20px',
    fontWeight: 600,
    lineHeight: 1.4,
    color: 'inherit',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    outlineStyle: 'none',
  },
  titleStatic: {
    paddingBlockStart: '4px',
    paddingBlockEnd: '8px',
    paddingInlineEnd: '40px',
    fontSize: '20px',
    fontWeight: 600,
    lineHeight: 1.4,
    color: cssVar.colorText,
  },
});

const GENERATION_ESTIMATE_SECONDS = 90;

export const formatGoalGenerationRemainingTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
};

export interface CreateGoalContentProps {
  /** The agent that owns the goal. Goals are always agent-scoped. */
  agentId?: string;
  /** Seed from an empty-state example. Only the plain fields — the instruction
   *  body falls back to the title, so the editor is never fought over. */
  initialRequirement?: string;
  initialRoundBudget?: number;
  initialTitle?: string;
  onCreated?: (goal: { agentId?: string; goalId: string }) => void;
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

  const [isCreating, setIsCreating] = useState(false);

  const [step, setStep] = useState<'describe' | 'preparing' | 'review'>('describe');
  const [plan, setPlan] = useState<CreateGoalParams>({
    criteria: [],
    instruction: initialRequirement ?? initialTitle ?? '',
    maxIterations: initialRoundBudget ?? DEFAULT_GOAL_MAX_ROUNDS,
    maxTotalCost: null,
    name: initialTitle ?? '',
  });
  const [remainingSeconds, setRemainingSeconds] = useState(GENERATION_ESTIMATE_SECONDS);
  // Who plans the goal (its main agent) and who does its Tasks. Unset executor
  // means the main agent does them itself.
  const [plannerId, setPlannerId] = useState(agentId);
  const [executorId, setExecutorId] = useState<string>();

  const editor = useEditor();
  const instructionRef = useRef(plan.instruction);

  useEffect(() => {
    if (step !== 'preparing') return;
    setRemainingSeconds(GENERATION_ESTIMATE_SECONDS);
    const timer = window.setInterval(
      () => setRemainingSeconds((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [step]);

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
        goal: instruction,
      });
      instructionRef.current = generated.instruction;
      setPlan((current) => ({
        ...current,
        criteria: generated.criteria,
        instruction: generated.instruction,
        name: generated.title,
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
  }, [canCreate, plan.instruction, plan.name, t]);

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
    const reviewedCriteria = plan.criteria.filter((criterion) => criterion.title.trim());
    if (!instruction || reviewedCriteria.length === 0) return;

    const title = plan.name.trim() || instruction;
    const budget = buildGoalCreateInput({
      costBudget: plan.maxTotalCost,
      instruction,
    });

    setIsCreating(true);
    try {
      const { agentId: goalAgentId, taskAgentId } = buildGoalAgents(plannerId, executorId);
      const graph = await goalService.create({
        agentId: goalAgentId,
        config: {
          recovery: { maxAttemptsPerTask: resolveGoalAttemptBudget(plan.maxIterations) },
          ...(taskAgentId ? { taskAgentId } : {}),
        },
        // `maxIterations` is the per-Task attempt budget above; it is not the
        // graph-wide round cap, which counts runs across every Task and would
        // strand the fourth task of a goal whose limit is three attempts.
        // Structured criteria persist alongside the prose requirement: the goal
        // page shows/edits them and the terminal acceptance is gated on them.
        criteria: reviewedCriteria.map(({ description, instruction: how, title: name }) => ({
          description,
          instruction: how,
          title: name,
        })),
        maxTotalCost: budget.maxTotalCost ?? undefined,
        // No seed tasks: the coordinator plans the decomposition on first
        // advance, turning a complex ask into several explorable directions.
        ...buildReviewedGoalContent(instruction),
        projectId,
        title,
      });
      // `goal.create` already queued the first advance server-side, but on a
      // queue-less serverless deployment that kickoff is an in-process timer
      // the host may freeze before firing. This request-bound advance is the
      // durable fallback — fired and forgotten so the modal still closes
      // immediately; the server dedupes a raced decomposition.
      void goalService.advance(graph.goal.id).catch(() => {});
      close();
      onCreated?.({ agentId: graph.goal.agentId ?? undefined, goalId: graph.goal.id });
    } catch (error) {
      console.error('[CreateGoalContent] create failed:', error);
      toast.error(t('createGoal.createFailed'));
    } finally {
      setIsCreating(false);
    }
  }, [canCreate, close, executorId, onCreated, plan, plannerId, projectId, t]);

  const handlePrimaryAction =
    step === 'describe' ? handleNext : step === 'review' ? handleSubmit : undefined;
  const handleSubmitRef = useRef(handlePrimaryAction);
  const generatingMessages = [
    t('createGoal.generating'),
    t('createGoal.generatingInstruction'),
    t('createGoal.generatingCriteria'),
    t('createGoal.generatingReview'),
    t('createGoal.generating'),
  ];
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

  // Escape is easy to hit by accident, so it asks before throwing away a
  // described or drafted goal; an untouched modal still closes straight away.
  const rootRef = useRef<HTMLDivElement>(null);
  useEscapeDiscardGuard(rootRef, {
    hasUnsavedInput: () =>
      hasUnsavedGoalDraft({
        editorJson: editor?.getDocument?.('json'),
        initialInstruction: initialRequirement ?? initialTitle,
        instruction: instructionRef.current,
        step,
      }),
    onEscape: () =>
      confirmModal({
        cancelText: t('createGoal.discardConfirm.cancel'),
        content: t('createGoal.discardConfirm.content'),
        okButtonProps: { danger: true },
        okText: t('createGoal.discardConfirm.ok'),
        onOk: close,
        title: t('createGoal.discardConfirm.title'),
      }),
  });

  return (
    <Flexbox flex={1} ref={rootRef} style={{ minHeight: 0 }} onKeyDown={handleKeyDown}>
      {/* The describe step's editor lives in the head, so the head shrinks and
          its editor scrolls; on review only the body below scrolls. */}
      <Flexbox
        horizontal
        className={stylex.props(styles.head).className}
        style={{ flexShrink: step === 'review' ? 0 : 1 }}
      >
        <Flexbox flex={1} gap={6} style={{ minHeight: 0 }}>
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
              className={stylex.props(styles.title).className}
              disabled={!canCreate}
              placeholder={t('createGoal.titlePlaceholder')}
              value={plan.name}
              onChange={(e) => setPlan((current) => ({ ...current, name: e.target.value }))}
            />
          ) : (
            <div className={stylex.props(styles.titleStatic).className}>
              {t('createGoal.describeTitle')}
            </div>
          )}
          {step !== 'review' && (
            <>
              <GeneratingBorder
                className={stylex.props(styles.inputShell).className}
                generating={step === 'preparing'}
              >
                <div className={stylex.props(styles.inputScroller).className}>
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
              </GeneratingBorder>
              {step === 'preparing' ? (
                <Flexbox
                  horizontal
                  align={'center'}
                  className={stylex.props(styles.generatingStatus).className}
                  gap={10}
                  justify={'space-between'}
                >
                  <Flexbox horizontal align={'center'} gap={8}>
                    <Spin size="small" variant="network" />
                    <div
                      aria-label={t('createGoal.generating')}
                      className={stylex.props(styles.generatingTextViewport).className}
                      role={'status'}
                    >
                      <div
                        aria-hidden
                        className={stylex.props(styles.generatingTextTrack).className}
                      >
                        {generatingMessages.map((message, index) => (
                          <div
                            key={index}
                            className={
                              sx([styles.generatingTextItem], shinyTextStyles.shinyText).className
                            }
                          >
                            {message}
                          </div>
                        ))}
                      </div>
                    </div>
                  </Flexbox>
                  <Text fontSize={12} type={'secondary'}>
                    {remainingSeconds > 0
                      ? t('createGoal.generatingCountdown', {
                          time: formatGoalGenerationRemainingTime(remainingSeconds),
                        })
                      : t('createGoal.generatingAlmostDone')}
                  </Text>
                </Flexbox>
              ) : (
                <Text type={'secondary'}>{t('createGoal.describeHint')}</Text>
              )}
            </>
          )}
        </Flexbox>
        <ActionIcon className={stylex.props(styles.close).className} icon={X} onClick={close} />
      </Flexbox>

      {step === 'review' && (
        <Flexbox className={stylex.props(styles.body).className}>
          <Flexbox className={stylex.props(styles.reviewSection).className} gap={10}>
            <Flexbox
              className={sx([styles.instructionEditor], moduleStyles.instructionEditor).className}
            >
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

          <Flexbox className={stylex.props(styles.reviewSection).className} gap={10}>
            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <Flexbox horizontal align={'center'} gap={8}>
                <Icon color={cssVar.colorTextTertiary} icon={ShieldCheck} size={16} />
                <Text fontSize={13} style={{ flex: 'none' }} weight={600}>
                  {t('createGoal.criteriaTitle')}
                </Text>
                <Text className={stylex.props(styles.sectionHint).className} fontSize={12}>
                  {t('createGoal.criteriaHint')}
                </Text>
              </Flexbox>
              <Button icon={Plus} size={'small'} type={'text'} onClick={addCriterion}>
                {t('createGoal.addCriterion')}
              </Button>
            </Flexbox>
            {/* Draft rows keep the C{seq} anchor but no status icon — the pending
                circle belongs to the post-creation check list, not to authoring. */}
            <CriterionList className={stylex.props(styles.criteriaList).className}>
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

          <Flexbox className={stylex.props(styles.reviewSection).className} gap={10}>
            <Text fontSize={13} weight={600}>
              {t('createGoal.agentsTitle')}
            </Text>
            <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
              <GoalAgentPill
                agentId={plannerId}
                disabled={!canCreate}
                disabledReason={reason}
                label={t('goalDetail.mainAgentLabel')}
                placeholder={t('goalDetail.mainAgentUnassigned')}
                tooltip={t('goalDetail.mainAgent')}
                onChange={(next) => {
                  if (!next) return;
                  setPlannerId(next);
                  // One agent, one slot: the new main agent does its own Tasks.
                  if (next === executorId) setExecutorId(undefined);
                }}
              />
              {plannerId && (
                <GoalAgentPill
                  agentId={executorId}
                  disabled={!canCreate}
                  disabledReason={reason}
                  label={t('goalDetail.taskAgentLabel')}
                  placeholder={t('goalDetail.taskAgentFollowsMain')}
                  tooltip={t('goalDetail.taskAgent')}
                  onChange={(next) => setExecutorId(next && next !== plannerId ? next : undefined)}
                />
              )}
            </Flexbox>
            <Text className={stylex.props(styles.sectionHint).className} fontSize={12}>
              {t('createGoal.agentsHint')}
            </Text>
          </Flexbox>

          <Flexbox className={stylex.props(styles.reviewSection).className} gap={10}>
            <Text fontSize={13} weight={600}>
              {t('createGoal.budgetTitle')}
            </Text>
            <Flexbox gap={12}>
              <div className={stylex.props(styles.budgetField).className}>
                <Text fontSize={12} type={'secondary'}>
                  {t('createGoal.roundBudgetLabel')}
                </Text>
                <InputNumber
                  disabled={!canCreate}
                  min={2}
                  size={'small'}
                  style={{ width: '100%' }}
                  value={plan.maxIterations ?? null}
                  variant={'filled'}
                  suffix={
                    <Text fontSize={12} type={'secondary'}>
                      {t('createGoal.roundsUnit')}
                    </Text>
                  }
                  onChange={(value) => setPlan((current) => ({ ...current, maxIterations: value }))}
                />
                <Text className={stylex.props(styles.sectionHint).className} fontSize={12}>
                  {t('createGoal.roundBudgetHint')}
                </Text>
              </div>

              <div className={stylex.props(styles.budgetField).className}>
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
                <Text className={stylex.props(styles.sectionHint).className} fontSize={12}>
                  {t('createGoal.costBudgetHint')}
                </Text>
              </div>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      )}

      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.footer).className}
        justify={'space-between'}
      >
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
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
