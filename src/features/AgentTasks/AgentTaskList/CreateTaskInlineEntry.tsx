'use client';

import { canWorkspaceRoleBeTaskAssignee } from '@lobechat/const/rbac';
import { useEditor } from '@lobehub/editor/react';
import { Block, Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, Text, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { $getRoot } from 'lexical';
import { ChevronUp, Paperclip } from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';
import { EditorCanvas } from '@/features/EditorCanvas';
import {
  getAttachmentFileIdsFromEditor,
  pickAndInsertAttachments,
} from '@/features/EditorCanvas/editorAttachments';
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { useTaskStore } from '@/store/task';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import AssigneeMemberSelector from '../features/AssigneeMemberSelector';
import AssigneeUserAvatar from '../features/AssigneeUserAvatar';
import TaskPriorityTag from '../features/TaskPriorityTag';
import TaskVisibilityChipLabel from '../features/TaskVisibilityChipLabel';
import TaskVisibilityTag from '../features/TaskVisibilityTag';
import { UnassignedAssigneeIcon } from '../features/UnassignedAssigneeIcon';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';
import { useAgentVisibility } from '../shared/useAgentVisibility';
import { useUserDisplayMeta } from '../shared/useUserDisplayMeta';

interface CreateTaskInlineEntryProps {
  agentId?: string;
  autoFocus?: boolean;
  /**
   * Baseline visibility for a fresh composer. Top-level creates default to
   * workspace-visible; the subtask composer passes its parent's visibility so
   * a child under a private parent doesn't default to a combination the server
   * rejects (a subtask cannot be more public than its parent).
   */
  defaultVisibility?: 'private' | 'public';
  /**
   * Locks the assignee to `agentId` and hides the agent picker. Used on the
   * agent-scoped task list where every task belongs to that agent.
   */
  lockAssignee?: boolean;
  onCollapse?: () => void;
  onCreated?: (task: { agentId?: string; identifier: string }) => void;
  parentTaskId?: string;
  placeholder?: string;
  projectId?: string;
  /**
   * `hero` adapts the entry for the empty-tasks landing: hides collapse,
   * enlarges the editor area, and forces autoFocus.
   */
  variant?: 'default' | 'hero';
}

const CreateTaskInlineEntry = memo<CreateTaskInlineEntryProps>((props) => {
  const {
    agentId,
    autoFocus,
    defaultVisibility = 'public',
    lockAssignee,
    onCollapse,
    onCreated,
    parentTaskId,
    placeholder,
    projectId,
    variant = 'default',
  } = props;
  const isHero = variant === 'hero';
  const { t } = useTranslation('chat');
  const { allowed: canCreateTask, reason } = usePermission('create_content');

  const createTask = useTaskStore((s) => s.createTask);
  const isCreating = useTaskStore((s) => s.isCreatingTask);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const activeWorkspaceId = useActiveWorkspaceId();
  const { isLoading: isMembersLoading } = useFetchWorkspaceMembers();
  const workspaceMembers = useWorkspaceMembers();
  const assignableMemberIds = useMemo(
    () =>
      new Set(
        workspaceMembers
          .filter((member) => canWorkspaceRoleBeTaskAssignee(member.role))
          .map((member) => member.userId),
      ),
    [workspaceMembers],
  );
  const [priority, setPriority] = useState(0);
  const [assigneeAgentId, setAssigneeAgentId] = useState<string | undefined>(agentId);
  const [assigneeUserId, setAssigneeUserId] = useState<string | undefined>();
  const [instruction, setInstruction] = useState('');
  const [hasAttachments, setHasAttachments] = useState(false);
  // Default to workspace-visible (or the parent's visibility for subtasks).
  // In personal mode the chip is hidden and the value is never sent.
  const [visibility, setVisibility] = useState<'private' | 'public'>(defaultVisibility);

  const assigneeVisibility = useAgentVisibility(assigneeAgentId);
  const isPrivateAgent = assigneeVisibility === 'private';
  const selfUserId = useUserStore(userProfileSelectors.userId);
  const isOtherMemberAssignee = Boolean(assigneeUserId) && assigneeUserId !== selfUserId;

  // Resolve the two visibility constraints in one place so an old draft or an
  // externally privatized agent cannot make separate effects toggle forever.
  // A private agent is the stronger constraint, so drop an incompatible member.
  useEffect(() => {
    if (isPrivateAgent) {
      if (isOtherMemberAssignee) setAssigneeUserId(undefined);
      if (visibility === 'public') setVisibility('private');
      return;
    }

    if (isOtherMemberAssignee && visibility === 'private') setVisibility('public');
  }, [isOtherMemberAssignee, isPrivateAgent, visibility]);

  const editor = useEditor();

  // Persist the in-progress draft per scope so a reload / accidental close
  // doesn't eat a long prompt. Skipped for the transient subtask composer.
  const draftStorageKey = useMemo(
    () =>
      parentTaskId
        ? null
        : `lobehub:task-create-draft:${activeWorkspaceId ?? 'personal'}:${projectId ?? agentId ?? 'all'}`,
    [activeWorkspaceId, agentId, parentTaskId, projectId],
  );
  // Tracks which scope key the editor is currently hydrated for. The component
  // is reused across workspace and task-scope route switches without unmounting.
  // State (instead of a ref) keeps the persistence effect from writing the old
  // scope's member into the new key during the same effect flush as the reset.
  const [draftHydratedKey, setDraftHydratedKey] = useState<string | null>(null);

  const assigneeMeta = useAgentDisplayMeta(assigneeAgentId);
  const memberMeta = useUserDisplayMeta(assigneeUserId);

  const handleAgentChange = useCallback((nextAgentId: string | null) => {
    setAssigneeAgentId(nextAgentId ?? undefined);
  }, []);
  const handleMemberChange = useCallback((nextUserId: string | null) => {
    setAssigneeUserId(nextUserId ?? undefined);
  }, []);

  // When the assignee is locked to a scoped agent, keep it in sync with the
  // `agentId` prop. The route subtree is reused across /agent/A/tasks ->
  // /agent/B/tasks and /agent/A/tasks -> /tasks, so without this the hidden
  // assignee would stay on the previous scoped agent.
  useEffect(() => {
    if (lockAssignee) {
      setAssigneeAgentId(agentId);
      setAssigneeUserId(undefined);
      return;
    }

    if (!agentId) setAssigneeAgentId(undefined);
  }, [agentId, lockAssignee]);

  useEffect(() => {
    if (!canCreateTask) return;
    if (autoFocus || isHero) editor?.focus?.();
  }, [autoFocus, canCreateTask, editor, isHero]);

  // Hydrate the editor with the current scope's saved draft. Re-runs whenever
  // the scope key changes (not just on mount): it first resets to this scope's
  // baseline so a previous scope's draft can't leak across a switch, then loads
  // the new key's draft. The editor's onContentChange syncs `instruction`.
  useEffect(() => {
    if (!draftStorageKey || !editor) return;
    // Workspace drafts depend on the member directory. Wait for its first
    // response so a removed or downgraded member is never restored into a
    // composer state that the create API will reject.
    if (activeWorkspaceId && isMembersLoading) return;
    if (draftHydratedKey === draftStorageKey) return;
    setDraftHydratedKey(draftStorageKey);

    // Reset to baseline for the new scope before hydrating.
    editor.cleanDocument?.();
    setPriority(0);
    setVisibility(defaultVisibility);
    if (!lockAssignee) setAssigneeAgentId(agentId);
    setAssigneeUserId(undefined);

    let raw: string | null;
    try {
      raw = localStorage.getItem(draftStorageKey);
    } catch {
      raw = null;
    }
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as {
        assigneeAgentId?: string;
        assigneeUserId?: string;
        markdown?: string;
        priority?: number;
        visibility?: 'private' | 'public';
      };
      if (draft.markdown) editor.setDocument?.('markdown', draft.markdown);
      if (typeof draft.priority === 'number') setPriority(draft.priority);
      if (!lockAssignee && draft.assigneeAgentId) setAssigneeAgentId(draft.assigneeAgentId);
      if (
        draft.assigneeUserId &&
        (!activeWorkspaceId || assignableMemberIds.has(draft.assigneeUserId))
      ) {
        setAssigneeUserId(draft.assigneeUserId);
      }
      if (draft.visibility) setVisibility(draft.visibility);
    } catch {
      /* ignore a malformed draft */
    }
  }, [
    activeWorkspaceId,
    agentId,
    assignableMemberIds,
    defaultVisibility,
    draftHydratedKey,
    draftStorageKey,
    editor,
    isMembersLoading,
    lockAssignee,
  ]);

  // Back the draft to storage on every change. Gated behind the restore pass so
  // the initial render can't clobber a just-read draft. Write-only on non-empty:
  // the key is cleared only on a successful submit (below), never here — so a
  // `setDocument`-timing gap right after restore can't wipe a valid draft.
  useEffect(() => {
    if (!draftStorageKey || draftHydratedKey !== draftStorageKey || !editor) return;
    const markdown = String(editor.getDocument?.('markdown') ?? '').trim();
    if (!markdown) return;
    try {
      localStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          assigneeAgentId: lockAssignee ? undefined : assigneeAgentId,
          // `lockAssignee` locks only the scoped Agent. The responsible
          // member remains an independent draft field and must survive reloads.
          assigneeUserId,
          markdown,
          priority,
          visibility,
        }),
      );
    } catch {
      /* storage unavailable / quota — persistence is best-effort */
    }
  }, [
    assigneeAgentId,
    assigneeUserId,
    draftHydratedKey,
    draftStorageKey,
    editor,
    instruction,
    lockAssignee,
    priority,
    visibility,
  ]);

  const handleCollapse = useCallback(() => {
    if (onCollapse) {
      onCollapse();
      return;
    }
    updateSystemStatus({ taskCreateInlineCollapsed: true }, 'collapseTaskCreateInline');
  }, [onCollapse, updateSystemStatus]);

  const handleContentChange = useCallback(() => {
    if (!canCreateTask) return;
    const lexicalEditor = editor?.getLexicalEditor?.();
    if (!lexicalEditor) return;
    lexicalEditor.getEditorState().read(() => {
      setInstruction($getRoot().getTextContent());
    });
    setHasAttachments(getAttachmentFileIdsFromEditor(editor).length > 0);
  }, [canCreateTask, editor]);

  const handleAttach = useCallback(() => {
    pickAndInsertAttachments(editor);
  }, [editor]);

  const handleSubmit = useCallback(async () => {
    if (!canCreateTask) return;
    const markdown = String(editor?.getDocument?.('markdown') ?? '').trim();
    const trimmedText = instruction.trim();
    const hasFiles = getAttachmentFileIdsFromEditor(editor).length > 0;
    if (!trimmedText && !markdown && !hasFiles) return;

    const firstLine =
      trimmedText
        .split('\n')
        .find((line) => line.trim())
        ?.trim() ?? trimmedText;
    let name: string | undefined;
    if (firstLine) {
      name = firstLine.length > 30 ? `${firstLine.slice(0, 30)}…` : firstLine;
    }

    const editorJson = editor?.getDocument?.('json') as unknown;

    // `createTask` keeps its rejecting contract (other callers rely on `catch`);
    // handle the composer's own failure here so it isn't silent, keeping the
    // draft intact (the reset only runs on success).
    try {
      const result = await createTask({
        assigneeAgentId,
        assigneeUserId,
        editorData: editorJson,
        instruction: markdown || trimmedText || name || '',
        name,
        parentTaskId,
        priority: priority || undefined,
        projectId,
        // Only send visibility in workspace mode; personal mode lets the server
        // fall through to the schema default ('public', inert in personal mode).
        visibility: activeWorkspaceId ? visibility : undefined,
      });

      if (result) {
        setPriority(0);
        setAssigneeAgentId(agentId);
        setAssigneeUserId(undefined);
        setInstruction('');
        setVisibility(defaultVisibility);
        editor?.cleanDocument?.();
        if (draftStorageKey) {
          try {
            localStorage.removeItem(draftStorageKey);
          } catch {
            /* ignore */
          }
        }
        onCreated?.({
          agentId: result.assigneeAgentId ?? undefined,
          identifier: result.identifier,
        });
      }
    } catch {
      toast.error(t('createTask.createFailed'));
    }
  }, [
    t,
    activeWorkspaceId,
    agentId,
    assigneeAgentId,
    assigneeUserId,
    createTask,
    defaultVisibility,
    draftStorageKey,
    editor,
    instruction,
    onCreated,
    parentTaskId,
    priority,
    projectId,
    canCreateTask,
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
    <Block
      style={{ overflow: 'hidden', position: 'relative' }}
      variant={'outlined'}
      onKeyDownCapture={handleKeyDown}
    >
      {!isHero && (
        <ActionIcon
          icon={ChevronUp}
          size={'small'}
          style={{ position: 'absolute', right: 8, top: 8, zIndex: 1 }}
          title={t('createTask.collapse')}
          onClick={handleCollapse}
        />
      )}
      <Flexbox
        style={{
          fontSize: isHero ? 16 : 14,
          // Cap the editor so a long draft scrolls inside the box instead of
          // growing the composer until it pushes the task list below the fold.
          maxHeight: isHero ? 360 : 200,
          overflowY: 'auto',
          padding: isHero ? '12px 16px 0' : '8px 40px 0 16px',
        }}
      >
        <EditorCanvas
          disabled={!canCreateTask}
          editor={editor}
          floatingToolbar={false}
          placeholder={placeholder ?? t('createTask.instructionPlaceholder')}
          style={{
            fontSize: isHero ? 16 : 14,
            minHeight: isHero ? 80 : undefined,
            paddingBottom: 12,
          }}
          onContentChange={handleContentChange}
        />
      </Flexbox>
      <Flexbox
        horizontal
        align={'center'}
        justify={'space-between'}
        style={{
          borderTop: `1px solid ${cssVar.colorBorderSecondary}`,
          paddingBlock: 8,
          paddingInline: '8px 16px',
        }}
      >
        <Flexbox horizontal align={'center'} gap={2} wrap={'wrap'}>
          <TaskPriorityTag priority={priority} onChange={setPriority}>
            <Block
              clickable
              horizontal
              align="center"
              gap={6}
              height={24}
              paddingBlock={3}
              paddingInline={8}
              variant={'borderless'}
            >
              <TaskPriorityTag disableDropdown priority={priority} size={14} />
              <Text fontSize={12}>
                {priority === 0
                  ? t('taskDetail.priority.none')
                  : t(
                      `taskDetail.priority.${(['', 'urgent', 'high', 'normal', 'low'] as const)[priority]}` as never,
                    )}
              </Text>
            </Block>
          </TaskPriorityTag>

          {activeWorkspaceId && (
            <AssigneeMemberSelector
              currentUserId={assigneeUserId}
              taskVisibility={visibility}
              onChange={handleMemberChange}
            >
              <Block
                clickable
                horizontal
                align="center"
                gap={6}
                height={24}
                paddingBlock={3}
                paddingInline={8}
                variant={'borderless'}
              >
                {assigneeUserId ? (
                  <>
                    <AssigneeUserAvatar size={18} userId={assigneeUserId} />
                    <Text fontSize={12}>{memberMeta?.title}</Text>
                  </>
                ) : (
                  <>
                    <UnassignedAssigneeIcon kind={'human'} size={14} />
                    <Text color={cssVar.colorTextDescription} fontSize={12}>
                      {t('createTask.member')}
                    </Text>
                  </>
                )}
              </Block>
            </AssigneeMemberSelector>
          )}

          {lockAssignee ? (
            <Block
              horizontal
              align="center"
              gap={6}
              height={24}
              paddingBlock={3}
              paddingInline={8}
              variant={'borderless'}
            >
              <AssigneeAvatar agentId={assigneeAgentId} size={18} />
              <Text fontSize={12}>{assigneeMeta?.title}</Text>
            </Block>
          ) : (
            <AssigneeAgentSelector
              currentAgentId={assigneeAgentId}
              taskVisibility={isOtherMemberAssignee ? 'public' : undefined}
              onChange={handleAgentChange}
            >
              <Block
                clickable
                horizontal
                align="center"
                gap={6}
                height={24}
                paddingBlock={3}
                paddingInline={8}
                variant={'borderless'}
              >
                {assigneeAgentId ? (
                  <>
                    <AssigneeAvatar agentId={assigneeAgentId} size={18} />
                    <Text fontSize={12}>{assigneeMeta?.title}</Text>
                  </>
                ) : (
                  <>
                    <UnassignedAssigneeIcon kind={'agent'} size={14} />
                    <Text color={cssVar.colorTextDescription} fontSize={12}>
                      {t('createTask.assignee')}
                    </Text>
                  </>
                )}
              </Block>
            </AssigneeAgentSelector>
          )}

          <ActionIcon
            icon={Paperclip}
            size={'small'}
            title={t('upload.action.tooltip')}
            onClick={handleAttach}
          />
        </Flexbox>

        <Flexbox horizontal align={'center'} gap={4}>
          {activeWorkspaceId && (
            <TaskVisibilityTag
              visibility={visibility}
              lockedReason={
                isPrivateAgent
                  ? t('createTask.visibility.privateAgentLocked', {
                      defaultValue: 'Private agents can only run private tasks.',
                    })
                  : isOtherMemberAssignee
                    ? t('createTask.visibility.memberAssigneeLocked', {
                        defaultValue: 'A task assigned to a member stays visible to the workspace.',
                      })
                    : undefined
              }
              onChange={setVisibility}
            >
              <TaskVisibilityChipLabel height={24} paddingBlock={3} visibility={visibility} />
            </TaskVisibilityTag>
          )}

          <Button
            disabled={!canCreateTask || isCreating || (!instruction.trim() && !hasAttachments)}
            loading={isCreating}
            shape={'round'}
            size={'small'}
            title={canCreateTask ? undefined : reason}
            type={'primary'}
            onClick={handleSubmit}
          >
            {t('createTask.submit')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Block>
  );
});

export default CreateTaskInlineEntry;
