import type { TaskTemplate } from '@lobechat/const';
import { App } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { taskTemplateService } from '@/services/taskTemplate';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useTaskStore } from '@/store/task';

import { SkillConnectionPopupBlockedError, useSkillConnection } from './useSkillConnection';

interface UseTaskTemplateCreateOptions {
  description: string;
  onCreated: (templateId: number) => void;
  template: TaskTemplate;
  title: string;
}

export interface UseTaskTemplateCreateResult {
  created: boolean;
  disabled: boolean;
  handleAddTask: () => void;
  handleConnectError: (error: unknown) => void;
  loading: boolean;
  pendingCreate: boolean;
  primaryButtonLabel: string;
}

export const useTaskTemplateCreate = ({
  description,
  onCreated,
  template,
  title,
}: UseTaskTemplateCreateOptions): UseTaskTemplateCreateResult => {
  const { t } = useTranslation('taskTemplate');
  const { message } = App.useApp();
  const { allowed: canCreateTask } = usePermission('create_content');
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(false);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const createTask = useTaskStore((s) => s.createTask);
  const navigate = useWorkspaceAwareNavigate();
  const requiredConnectors = useMemo(
    () => template.connectors.filter((connector) => connector.required),
    [template.connectors],
  );
  const requiredConnection = useSkillConnection(requiredConnectors);

  const handleCreate = useCallback(async () => {
    if (!canCreateTask) return;
    if (!inboxAgentId) return;
    setLoading(true);
    try {
      const createdTask = await createTask({
        assigneeAgentId: inboxAgentId,
        automationMode: 'schedule',
        description,
        instruction: template.instruction,
        name: title,
        schedulePattern: template.cronPattern,
        scheduleTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      await taskTemplateService.recordCreated(template.id).catch((recordError) => {
        console.error('[taskTemplate:recordCreated]', recordError);
      });
      setCreated(true);
      onCreated(template.id);
      if (createdTask?.identifier) {
        navigate(
          taskDetailPath(createdTask.identifier, createdTask.assigneeAgentId ?? inboxAgentId),
        );
      }
    } catch (error) {
      console.error('[taskTemplate:create]', error);
      message.error(t('action.create.error'));
    } finally {
      setLoading(false);
    }
  }, [
    createTask,
    description,
    inboxAgentId,
    message,
    navigate,
    onCreated,
    t,
    template.cronPattern,
    template.id,
    template.instruction,
    title,
    canCreateTask,
  ]);

  const handleConnectError = useCallback(
    (error: unknown) => {
      message.error(
        error instanceof SkillConnectionPopupBlockedError
          ? t('action.connect.popupBlocked')
          : t('action.connect.error'),
      );
    },
    [message, t],
  );

  // Drive the "click Add task -> chain OAuth popups -> create task" flow via a
  // pending flag instead of awaiting connect(): useSkillConnection returns as
  // soon as the popup opens, with real status arriving through store polling.
  const [pendingCreate, setPendingCreate] = useState(false);
  const requiredConnectionRef = useRef(requiredConnection);
  requiredConnectionRef.current = requiredConnection;
  const handleCreateRef = useRef(handleCreate);
  handleCreateRef.current = handleCreate;
  const handleConnectErrorRef = useRef(handleConnectError);
  handleConnectErrorRef.current = handleConnectError;

  useEffect(() => {
    if (!pendingCreate) return;
    if (requiredConnection.isConnecting) return;
    if (requiredConnection.needsConnect) {
      requiredConnectionRef.current.connect().catch((error) => {
        setPendingCreate(false);
        handleConnectErrorRef.current(error);
      });
      return;
    }
    setPendingCreate(false);
    void handleCreateRef.current();
  }, [pendingCreate, requiredConnection.isConnecting, requiredConnection.needsConnect]);

  const handleAddTask = useCallback(() => {
    if (!canCreateTask) return;
    if (created || !inboxAgentId) return;
    if (requiredConnection.needsConnect) {
      setPendingCreate(true);
      return;
    }
    void handleCreate();
  }, [canCreateTask, created, inboxAgentId, requiredConnection.needsConnect, handleCreate]);

  const primaryButtonLabel = loading
    ? t('action.creating')
    : pendingCreate
      ? t('action.connecting')
      : t('action.createButton');

  return {
    created,
    disabled: !canCreateTask || created || !inboxAgentId,
    handleAddTask,
    handleConnectError,
    loading,
    pendingCreate,
    primaryButtonLabel,
  };
};
