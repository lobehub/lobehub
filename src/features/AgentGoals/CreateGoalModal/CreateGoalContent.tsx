'use client';

import type { CreateGoalParams, GoalCriterionDraft } from '@lobechat/builtin-tool-task';
import { DEFAULT_GOAL_MAX_ROUNDS } from '@lobechat/const/verify';
import { useEditor } from '@lobehub/editor/react';
import { ActionIcon, Block, Flexbox, Text, TextArea } from '@lobehub/ui';
import { Button, toast, useModalContext } from '@lobehub/ui/base-ui';
import { InputNumber } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeft, Paperclip, Plus, Trash2, X } from 'lucide-react';
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
  budgetLabel: css`
    flex: none;
    width: 68px;
    white-space: nowrap;
  `,
  budgetHint: css`
    min-width: 0;
  `,
  budgetRow: css`
    min-width: 0;
  `,
  body: css`
    overflow-y: auto;
    min-height: 0;
    padding-block-end: 16px;
  `,
  field: css`
    padding-inline: 24px;
  `,
  criteriaList: css`
    overflow-y: auto;
    max-height: 280px;
  `,
  criterion: css`
    padding-block: 10px;
    padding-inline: 12px;
  `,
  footer: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  head: css`
    padding-block: 16px 0;
    padding-inline: 24px;
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

  const [step, setStep] = useState<'describe' | 'review'>('describe');
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
    setStep('review');
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

  const handlePrimaryAction = step === 'describe' ? handleNext : handleSubmit;
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
    <Flexbox height={step === 'review' ? 'min(80vh, 720px)' : undefined} onKeyDown={handleKeyDown}>
      <Flexbox horizontal className={styles.head}>
        <Flexbox flex={1} gap={6}>
          {step === 'review' && (
            <Button
              icon={ArrowLeft}
              size={'small'}
              type={'text'}
              onClick={() => setStep('describe')}
            >
              {t('createGoal.back')}
            </Button>
          )}
          <input
            autoFocus={canCreate}
            className={styles.title}
            disabled={!canCreate}
            placeholder={t('createGoal.titlePlaceholder')}
            value={plan.name}
            onChange={(e) => setPlan((current) => ({ ...current, name: e.target.value }))}
          />
          {step === 'describe' && <Text type={'secondary'}>{t('createGoal.describeHint')}</Text>}
        </Flexbox>
        <ActionIcon icon={X} style={{ flexShrink: 0 }} onClick={close} />
      </Flexbox>

      {step === 'review' && (
        <Flexbox className={styles.body} flex={1} gap={16}>
          <Flexbox className={styles.field} gap={8}>
            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <Flexbox gap={2}>
                <Text fontSize={13} weight={500}>
                  {t('createGoal.criteriaTitle')}
                </Text>
                <Text fontSize={12} type={'secondary'}>
                  {t('createGoal.criteriaHint')}
                </Text>
              </Flexbox>
              <Button icon={Plus} size={'small'} onClick={addCriterion}>
                {t('createGoal.addCriterion')}
              </Button>
            </Flexbox>
            <Flexbox className={styles.criteriaList} gap={8}>
              {plan.criteria.map((criterion, index) => (
                <Block className={styles.criterion} key={index} variant={'outlined'}>
                  <Flexbox horizontal align={'flex-start'} gap={8}>
                    <TextArea
                      autoSize={{ maxRows: 3, minRows: 1 }}
                      disabled={!canCreate}
                      value={criterion.title}
                      onChange={(e) => updateCriterion(index, e.target.value)}
                    />
                    <ActionIcon
                      icon={Trash2}
                      title={t('createGoal.removeCriterion')}
                      onClick={() => removeCriterion(index)}
                    />
                  </Flexbox>
                </Block>
              ))}
            </Flexbox>
          </Flexbox>

          <Flexbox className={styles.field} gap={6}>
            <Text fontSize={13} weight={500}>
              {t('createGoal.contextLabel')}
            </Text>
            <EditorCanvas
              disabled={!canCreate}
              editor={editor}
              editorData={{ content: plan.instruction }}
              entityId={'create-goal-instruction'}
              floatingToolbar={false}
              placeholder={t('createGoal.instructionPlaceholder')}
              style={{ fontSize: 14, minHeight: 72 }}
              onContentChange={handleContentChange}
            />
          </Flexbox>
          <Flexbox className={styles.field} gap={12}>
            <Flexbox horizontal align={'center'} className={styles.budgetRow} gap={12}>
              <Text className={styles.budgetLabel} fontSize={13} weight={500}>
                {t('createGoal.roundBudgetLabel')}
              </Text>
              <InputNumber
                disabled={!canCreate}
                min={2}
                size={'small'}
                style={{ width: 120 }}
                suffix={t('createGoal.roundsUnit')}
                value={plan.maxIterations ?? undefined}
                variant={'filled'}
                onChange={(value) => setPlan((current) => ({ ...current, maxIterations: value }))}
              />
              <Text ellipsis className={styles.budgetHint} fontSize={12} type={'secondary'}>
                {t('createGoal.roundBudgetHint')}
              </Text>
            </Flexbox>

            <Flexbox horizontal align={'center'} className={styles.budgetRow} gap={12}>
              <Text className={styles.budgetLabel} fontSize={13} weight={500}>
                {t('createGoal.costBudgetLabel')}
              </Text>
              <InputNumber
                controls={false}
                disabled={!canCreate}
                min={0}
                placeholder={t('createGoal.costBudgetPlaceholder')}
                prefix={'$'}
                size={'small'}
                style={{ width: 120 }}
                value={plan.maxTotalCost}
                variant={'filled'}
                onChange={(value) => setPlan((current) => ({ ...current, maxTotalCost: value }))}
              />
              <Text ellipsis className={styles.budgetHint} fontSize={12} type={'secondary'}>
                {t('createGoal.costBudgetHint')}
              </Text>
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

        <Button
          loading={isCreating}
          shape={'round'}
          size={'small'}
          title={canCreate ? undefined : reason}
          type={'primary'}
          disabled={
            !canCreate ||
            isCreating ||
            !plan.name.trim() ||
            (step === 'review' && plan.criteria.every((criterion) => !criterion.title.trim()))
          }
          onClick={step === 'describe' ? handleNext : handleSubmit}
        >
          {step === 'describe' ? t('createGoal.next') : t('createGoal.submit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

CreateGoalContent.displayName = 'CreateGoalContent';

export default CreateGoalContent;
