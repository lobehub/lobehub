'use client';

import { DEFAULT_GOAL_MAX_ROUNDS } from '@lobechat/const/verify';
import { useEditor } from '@lobehub/editor/react';
import { ActionIcon, Flexbox, Text, TextArea } from '@lobehub/ui';
import { Button, Select, toast, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Paperclip, X } from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
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
import { useTaskStore } from '@/store/task';

import { buildGoalTaskConfig } from './goalConfig';

const styles = createStaticStyles(({ css }) => ({
  field: css`
    padding-inline: 24px;
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

  const [title, setTitle] = useState(initialTitle ?? '');
  const [requirement, setRequirement] = useState(initialRequirement ?? '');
  const [roundBudget, setRoundBudget] = useState<string>(
    String(initialRoundBudget ?? DEFAULT_GOAL_MAX_ROUNDS),
  );
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

  const handleContentChange = useCallback(() => {
    if (!canCreate || !editor) return;
    instructionRef.current = String(editor.getDocument('markdown') ?? '');
  }, [canCreate, editor]);

  const handleAttach = useCallback(() => {
    pickAndInsertAttachments(editor);
  }, [editor]);

  const handleSubmit = useCallback(async () => {
    if (!canCreate) return;
    const instruction = instructionRef.current.trim() || title.trim();
    if (!instruction) return;

    try {
      const result = await createTask({
        assigneeAgentId: agentId,
        config: buildGoalTaskConfig({
          instruction,
          requirement,
          roundBudget: roundBudget === 'uncapped' ? null : Number(roundBudget),
        }),
        editorData: editor?.getDocument?.('json') as unknown,
        instruction,
        name: title.trim() || undefined,
        visibility: activeWorkspaceId ? visibility : undefined,
      });

      if (result) {
        close();
        onCreated?.({
          agentId: result.assigneeAgentId ?? undefined,
          identifier: result.identifier,
        });
      }
    } catch {
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
    requirement,
    roundBudget,
    t,
    title,
    visibility,
  ]);

  const handleSubmitRef = useRef(handleSubmit);
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      void handleSubmitRef.current?.();
    }
  }, []);

  return (
    <Flexbox gap={16} onKeyDown={handleKeyDown}>
      <Flexbox horizontal className={styles.head}>
        <Flexbox flex={1} style={{ minHeight: 140 }}>
          <input
            autoFocus={canCreate}
            className={styles.title}
            disabled={!canCreate}
            placeholder={t('createGoal.titlePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <EditorCanvas
            disabled={!canCreate}
            editor={editor}
            floatingToolbar={false}
            placeholder={t('createGoal.instructionPlaceholder')}
            style={{ fontSize: 14, paddingBottom: 12 }}
            onContentChange={handleContentChange}
          />
        </Flexbox>
        <ActionIcon icon={X} style={{ flexShrink: 0 }} onClick={close} />
      </Flexbox>

      <Flexbox className={styles.field} gap={6}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Text fontSize={13} weight={500}>
            {t('createGoal.requirementLabel')}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {t('createGoal.requirementHint')}
          </Text>
        </Flexbox>
        <TextArea
          disabled={!canCreate}
          placeholder={t('createGoal.requirementPlaceholder')}
          rows={3}
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
        />
      </Flexbox>

      <Flexbox horizontal align={'center'} className={styles.field} gap={12} wrap={'wrap'}>
        <Text fontSize={13} style={{ whiteSpace: 'nowrap' }} weight={500}>
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
        <Text fontSize={12} type={'secondary'}>
          {roundBudget === 'uncapped'
            ? t('createGoal.roundBudgetUncappedHint')
            : t('createGoal.roundBudgetHint')}
        </Text>
      </Flexbox>

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
          <ActionIcon icon={Paperclip} title={t('upload.action.tooltip')} onClick={handleAttach} />
        </Flexbox>

        <Button
          disabled={!canCreate || isCreating}
          loading={isCreating}
          shape={'round'}
          size={'small'}
          title={canCreate ? undefined : reason}
          type={'primary'}
          onClick={handleSubmit}
        >
          {t('createGoal.submit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

CreateGoalContent.displayName = 'CreateGoalContent';

export default CreateGoalContent;
