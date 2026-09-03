'use client';

import { buildGoalRequirement, resolveGoalAttemptBudget } from '@lobechat/builtin-tool-goal';
import type { CreateGoalParams, GoalCriterionDraft } from '@lobechat/builtin-tool-task';
import { DEFAULT_GOAL_MAX_ROUNDS } from '@lobechat/const/verify';
import { useEditor } from '@lobehub/editor/react';
import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Button, Text, toast, useModalContext } from '@lobehub/ui/base-ui';
import { InputNumber } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
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

import GeneratingBorder from '@/components/GeneratingBorder';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import {
  CriterionList,
  CriterionRequiredChip,
  CriterionRow,
  openCriterionEditModal,
} from '@/features/Acceptance';
import { EditorCanvas } from '@/features/EditorCanvas';
import { pickAndInsertAttachments } from '@/features/EditorCanvas/editorAttachments';
import { usePermission } from '@/hooks/usePermission';
import { goalService } from '@/services/goal';
import { shinyTextStyles } from '@/styles';

import { buildGoalCreateInput } from './goalConfig';
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
  generatingStatus: css`
    min-height: 36px;
    padding-block: 6px;
    color: ${cssVar.colorTextSecondary};
  `,
  generatingTextItem: css`
    display: flex;
    align-items: center;

    height: 22px;

    font-size: 14px;
    font-weight: 500;
    line-height: 22px;
    white-space: nowrap;
  `,
  generatingTextTrack: css`
    animation: goal-generation-roll 16s cubic-bezier(0.4, 0, 0.2, 1) infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }

    @keyframes goal-generation-roll {
      0%,
      20% {
        transform: translateY(0);
      }

      25%,
      45% {
        transform: translateY(-22px);
      }

      50%,
      70% {
        transform: translateY(-44px);
      }

      75%,
      95% {
        transform: translateY(-66px);
      }

      100% {
        transform: translateY(-88px);
      }
    }
  `,
  generatingTextViewport: css`
    overflow: hidden;
    height: 22px;
  `,
  head: css`
    position: relative;
    padding-block: 16px 8px;
    padding-inline: 16px;
  `,
  inputShell: css`
    overflow: hidden;
    min-height: 208px;
    background: ${cssVar.colorBgElevated};
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

const GENERATION_ESTIMATE_SECONDS = 90;

export const formatGoalGenerationRemainingTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
};

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

  const editor = useEditor();
  const instructionRef = useRef(plan.instruction);
  const requirement = useMemo(() => criterionRequirement(plan.criteria), [plan.criteria]);

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
      requirement,
    });

    setIsCreating(true);
    try {
      const graph = await goalService.create({
        agentId,
        config: {
          recovery: { maxAttemptsPerTask: resolveGoalAttemptBudget(plan.maxIterations) },
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
        problemDescription: instruction,
        projectId,
        requirement: buildGoalRequirement(title, reviewedCriteria, budget.requirement),
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
  }, [agentId, canCreate, close, onCreated, plan, projectId, requirement, t]);

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

  return (
    <Flexbox onKeyDown={handleKeyDown}>
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
              <GeneratingBorder className={styles.inputShell} generating={step === 'preparing'}>
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
              </GeneratingBorder>
              {step === 'preparing' ? (
                <Flexbox
                  horizontal
                  align={'center'}
                  className={styles.generatingStatus}
                  gap={10}
                  justify={'space-between'}
                >
                  <Flexbox horizontal align={'center'} gap={8}>
                    <NeuralNetworkLoading size={18} />
                    <div
                      aria-label={t('createGoal.generating')}
                      className={styles.generatingTextViewport}
                      role={'status'}
                    >
                      <div aria-hidden className={styles.generatingTextTrack}>
                        {generatingMessages.map((message, index) => (
                          <div
                            className={`${styles.generatingTextItem} ${shinyTextStyles.shinyText}`}
                            key={index}
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
