'use client';

import { type CreateGoalParams, CreateGoalPlanEditor } from '@lobechat/builtin-tool-task/client';
import { DEFAULT_GOAL_MAX_ROUNDS } from '@lobechat/const/verify';
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { Button, toast, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { X } from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import TaskVisibilityChipLabel from '@/features/AgentTasks/features/TaskVisibilityChipLabel';
import TaskVisibilityTag from '@/features/AgentTasks/features/TaskVisibilityTag';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import { useAgentVisibility } from '@/features/AgentTasks/shared/useAgentVisibility';
import { usePermission } from '@/hooks/usePermission';
import { verifyService } from '@/services/verify';
import { useTaskStore } from '@/store/task';

import { buildGoalTaskConfig } from './goalConfig';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    min-height: 0;
    padding-block: 8px 16px;
    padding-inline: 24px;
  `,
  close: css`
    position: absolute;
    z-index: 3;
    inset-block-start: 14px;
    inset-inline-end: 16px;
  `,
  footer: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  root: css`
    position: relative;
  `,
}));

export interface CreateGoalContentProps {
  agentId?: string;
  initialRequirement?: string;
  initialRoundBudget?: number;
  initialTitle?: string;
  onCreated?: (goal: { agentId?: string; identifier: string }) => void;
}

const CreateGoalContent = memo<CreateGoalContentProps>(
  ({ agentId, initialRequirement, initialRoundBudget, initialTitle, onCreated }) => {
    const { t } = useTranslation('chat');
    const { close } = useModalContext();
    const { allowed: canCreate, reason } = usePermission('create_content');
    const createTask = useTaskStore((s) => s.createTask);
    const isCreating = useTaskStore((s) => s.isCreatingTask);
    const activeWorkspaceId = useActiveWorkspaceId();
    const assigneeMeta = useAgentDisplayMeta(agentId);
    const isPrivateAgent = useAgentVisibility(agentId) === 'private';
    const [visibility, setVisibility] = useState<'private' | 'public'>('private');
    const [plan, setPlan] = useState<CreateGoalParams>(() => ({
      criteria: initialRequirement
        ? [
            {
              onFail: 'auto_repair',
              required: true,
              title: initialRequirement,
              verifierType: 'agent',
            },
          ]
        : [],
      instruction: initialRequirement ?? initialTitle ?? '',
      maxIterations: initialRoundBudget ?? DEFAULT_GOAL_MAX_ROUNDS,
      maxTotalCost: null,
      name: initialTitle ?? '',
    }));
    const planRef = useRef(plan);
    const flushInstructionRef = useRef<(() => void | Promise<void>) | null>(null);
    const handlePlanChange = useCallback((value: CreateGoalParams) => {
      planRef.current = value;
      setPlan(value);
    }, []);
    const registerBeforeSubmit = useCallback(
      (_id: string, callback: () => void | Promise<void>) => {
        flushInstructionRef.current = callback;
        return () => {
          if (flushInstructionRef.current === callback) flushInstructionRef.current = null;
        };
      },
      [],
    );

    useEffect(() => {
      if (isPrivateAgent && visibility === 'public') setVisibility('private');
    }, [isPrivateAgent, visibility]);

    const handleSubmit = useCallback(async () => {
      if (!canCreate) return;
      await flushInstructionRef.current?.();
      const currentPlan = planRef.current;
      const instruction = currentPlan.instruction.trim() || currentPlan.name.trim();
      const criteria = currentPlan.criteria.filter((criterion) => criterion.title.trim());
      if (!currentPlan.name.trim() || !instruction || criteria.length === 0) return;

      let verifyCriteriaIds: string[] = [];
      try {
        verifyCriteriaIds = await verifyService.createCriteria(criteria);
        const result = await createTask({
          assigneeAgentId: agentId,
          config: buildGoalTaskConfig({
            costBudget: currentPlan.maxTotalCost,
            instruction,
            requirement: criteria.map((criterion) => `- ${criterion.title.trim()}`).join('\n'),
            roundBudget: currentPlan.maxIterations,
            verifyCriteriaIds,
          }),
          instruction,
          name: currentPlan.name.trim(),
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
    }, [activeWorkspaceId, agentId, canCreate, close, createTask, onCreated, t, visibility]);

    const handleSubmitRef = useRef(handleSubmit);
    handleSubmitRef.current = handleSubmit;
    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        void handleSubmitRef.current();
      }
    }, []);

    const valid =
      canCreate &&
      Boolean(plan.name.trim()) &&
      Boolean(plan.instruction.trim() || plan.name.trim()) &&
      plan.criteria.some((criterion) => criterion.title.trim());

    return (
      <Flexbox className={styles.root} height={'min(80vh, 720px)'} onKeyDown={handleKeyDown}>
        <ActionIcon className={styles.close} icon={X} onClick={close} />
        <Flexbox className={styles.body} flex={1}>
          <CreateGoalPlanEditor
            namePlaceholder={t('createGoal.titlePlaceholder')}
            registerBeforeApprove={registerBeforeSubmit}
            value={plan}
            onChange={handlePlanChange}
          />
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
          </Flexbox>
          <Button
            disabled={!valid || isCreating}
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
  },
);

CreateGoalContent.displayName = 'CreateGoalContent';

export default CreateGoalContent;
