import type { TaskTemplate } from '@lobechat/const';
import { App } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { taskTemplateService } from '@/services/taskTemplate';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useTaskStore } from '@/store/task';

import { SkillConnectionPopupBlockedError, useSkillConnection } from './useSkillConnection';

interface UseTaskTemplateCreateOptions {
  description: string;
  onCreated: (templateId: string) => void;
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
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(false);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const createTask = useTaskStore((s) => s.createTask);
  const navigate = useNavigate();
  const requiredConnection = useSkillConnection(template.requiresSkills);

  const handleCreate = useCallback(async () => {
    if (!inboxAgentId) return;
    setLoading(true);
    try {
      const instruction = t(`${template.id}.instruction`, { defaultValue: '' });
      const createdTask = await createTask({
        assigneeAgentId: inboxAgentId,
        automationMode: 'schedule',
        description,
        instruction,
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
        navigate(`/task/${createdTask.identifier}`);
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
    title,
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
    if (created || !inboxAgentId) return;
    if (requiredConnection.needsConnect) {
      setPendingCreate(true);
      return;
    }
    void handleCreate();
  }, [created, inboxAgentId, requiredConnection.needsConnect, handleCreate]);

  const primaryButtonLabel = loading
    ? t('action.creating')
    : pendingCreate
      ? t('action.connecting')
      : t('action.createButton');

  return {
    created,
    disabled: created || !inboxAgentId,
    handleAddTask,
    handleConnectError,
    loading,
    pendingCreate,
    primaryButtonLabel,
  };
};
