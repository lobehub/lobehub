'use client';

import { DEFAULT_GOAL_MAX_ROUNDS } from '@lobechat/const/verify';
import { useEditor } from '@lobehub/editor/react';
import { ActionIcon, Block, Flexbox, Text, TextArea } from '@lobehub/ui';
import { Button, Select, toast, useModalContext } from '@lobehub/ui/base-ui';
import { InputNumber } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeft, Paperclip, Sparkles, Trash2, X } from 'lucide-react';
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
import { type VerifyCriterionDraft, verifyService } from '@/services/verify';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
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

/** Offered round budgets; `null` is the explicit "no cap" the loop honors. */
const ROUND_BUDGETS: Array<number | null> = [2, 3, 5, 10, null];

const criterionRequirement = (drafts: VerifyCriterionDraft[]) =>
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

  const model = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgentModelById(agentId)(s) : '',
  );
  const provider = useAgentStore((s) =>
    agentId ? agentByIdSelectors.getAgentModelProviderById(agentId)(s) : '',
  );

  const [title, setTitle] = useState(initialTitle ?? '');
  const [step, setStep] = useState<'describe' | 'review'>('describe');
  const [criteria, setCriteria] = useState<VerifyCriterionDraft[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [roundBudget, setRoundBudget] = useState<string>(
    String(initialRoundBudget ?? DEFAULT_GOAL_MAX_ROUNDS),
  );
  // Empty = uncapped; the goal loop reads a null cost budget as "no limit".
  const [costBudget, setCostBudget] = useState<number | null>(null);
  // Default to private in workspace mode so sharing is opt-in; personal mode
  // ignores the field and hides the chip.
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');

  // A private agent can only run a private task, goals included.
  const isPrivateAgent = useAgentVisibility(agentId) === 'private';
  useEffect(() => {
    if (isPrivateAgent && visibility === 'public') setVisibility('private');
  }, [isPrivateAgent, visibility]);

  const editor = useEditor();
  const instructionRef = useRef('');
  const assigneeMeta = useAgentDisplayMeta(agentId);
  const requirement = useMemo(() => criterionRequirement(criteria), [criteria]);

  const handleContentChange = useCallback(() => {
    if (!canCreate || !editor) return;
    instructionRef.current = String(editor.getDocument('markdown') ?? '');
  }, [canCreate, editor]);

  const handleAttach = useCallback(() => {
    pickAndInsertAttachments(editor);
  }, [editor]);

  const handleGenerate = useCallback(async () => {
    const goal = title.trim();
    if (!canCreate || !goal || !model || !provider || isGenerating) return;

    setIsGenerating(true);
    try {
      const generated = await verifyService.generateCriteria({
        context: initialRequirement?.trim() || undefined,
        goal,
        maxCriteria: 5,
        modelConfig: { model, provider },
      });
      if (generated.length === 0) throw new Error('No acceptance criteria were generated.');
      setCriteria(generated);
      setStep('review');
    } catch (error) {
      console.error('[CreateGoalContent] criteria generation failed:', error);
      toast.error(t('createGoal.generateFailed'));
    } finally {
      setIsGenerating(false);
    }
  }, [canCreate, initialRequirement, isGenerating, model, provider, t, title]);

  const updateCriterion = useCallback((index: number, value: string) => {
    setCriteria((current) =>
      current.map((criterion, criterionIndex) =>
        criterionIndex === index ? { ...criterion, title: value } : criterion,
      ),
    );
  }, []);

  const removeCriterion = useCallback((index: number) => {
    setCriteria((current) => current.filter((_, criterionIndex) => criterionIndex !== index));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canCreate) return;
    const instruction = instructionRef.current.trim() || title.trim();
    const editorData = instructionRef.current.trim()
      ? (editor?.getDocument?.('json') as unknown)
      : undefined;
    const reviewedCriteria = criteria.filter((criterion) => criterion.title.trim());
    if (!instruction || reviewedCriteria.length === 0) return;

    let verifyCriteriaIds: string[] = [];
    try {
      verifyCriteriaIds = await verifyService.createCriteria(reviewedCriteria);
      const result = await createTask({
        assigneeAgentId: agentId,
        config: buildGoalTaskConfig({
          costBudget,
          instruction,
          requirement,
          roundBudget: roundBudget === 'uncapped' ? null : Number(roundBudget),
          verifyCriteriaIds,
        }),
        editorData,
        instruction,
        name: title.trim() || undefined,
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
    costBudget,
    criteria,
    createTask,
    editor,
    onCreated,
    requirement,
    roundBudget,
    t,
    title,
    visibility,
  ]);

  const handlePrimaryAction = step === 'describe' ? handleGenerate : handleSubmit;
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
            value={title}
            onChange={(e) => setTitle(e.target.value)}
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
              <Button
                icon={Sparkles}
                loading={isGenerating}
                size={'small'}
                onClick={handleGenerate}
              >
                {t('createGoal.regenerate')}
              </Button>
            </Flexbox>
            <Flexbox className={styles.criteriaList} gap={8}>
              {criteria.map((criterion, index) => (
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
              <Select
                disabled={!canCreate}
                size={'small'}
                value={roundBudget}
                options={ROUND_BUDGETS.map((rounds) => ({
                  label:
                    rounds === null
                      ? t('createGoal.roundBudget.uncapped')
                      : t('createGoal.roundBudget.rounds', { count: rounds }),
                  value: rounds === null ? 'uncapped' : String(rounds),
                }))}
                onChange={setRoundBudget}
              />
              <Text ellipsis className={styles.budgetHint} fontSize={12} type={'secondary'}>
                {roundBudget === 'uncapped'
                  ? t('createGoal.roundBudgetUncappedHint')
                  : t('createGoal.roundBudgetHint')}
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
                value={costBudget}
                variant={'filled'}
                onChange={(value) => setCostBudget(typeof value === 'number' ? value : null)}
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
          loading={step === 'describe' ? isGenerating : isCreating}
          shape={'round'}
          size={'small'}
          title={canCreate ? undefined : reason}
          type={'primary'}
          disabled={
            !canCreate ||
            isCreating ||
            isGenerating ||
            !title.trim() ||
            (step === 'review' && criteria.every((criterion) => !criterion.title.trim()))
          }
          onClick={step === 'describe' ? handleGenerate : handleSubmit}
        >
          {step === 'describe' ? t('createGoal.next') : t('createGoal.submit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

CreateGoalContent.displayName = 'CreateGoalContent';

export default CreateGoalContent;
