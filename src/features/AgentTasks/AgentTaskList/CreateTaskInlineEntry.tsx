'use client';

import { canWorkspaceRoleBeTaskAssignee } from '@lobechat/const/rbac';
import type { TaskIntentAnalysis } from '@lobechat/types';
import { useEditor } from '@lobehub/editor/react';
import { Block, DropdownMenu, Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, Text, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { $getRoot } from 'lexical';
import { ChevronDown, ChevronUp, Paperclip } from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';
import GeneratingBorder from '@/components/GeneratingBorder';
import { createGoalModal } from '@/features/AgentGoals/CreateGoalModal';
import { EditorCanvas } from '@/features/EditorCanvas';
import {
  getAttachmentFileIdsFromEditor,
  pickAndInsertAttachments,
} from '@/features/EditorCanvas/editorAttachments';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { taskService } from '@/services/task';
import { useGlobalStore } from '@/store/global';
import { useTaskStore } from '@/store/task';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, userProfileSelectors } from '@/store/user/selectors';
import { shinyTextStyles } from '@/styles';

import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import AssigneeMemberSelector from '../features/AssigneeMemberSelector';
import AssigneeUserAvatar from '../features/AssigneeUserAvatar';
import TaskPriorityTag from '../features/TaskPriorityTag';
import TaskVisibilityChipLabel from '../features/TaskVisibilityChipLabel';
import TaskVisibilityTag from '../features/TaskVisibilityTag';
import { UnassignedAssigneeIcon } from '../features/UnassignedAssigneeIcon';
import { taskDetailPath } from '../shared/taskDetailPath';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';
import { useAgentVisibility } from '../shared/useAgentVisibility';
import { useUserDisplayMeta } from '../shared/useUserDisplayMeta';
import {
  answeredClarifications,
  buildConfirmedDraft,
  buildGoalSeed,
  type ClarificationAnswers,
  shouldConfirmIntent,
} from './taskIntent';
import TaskIntentReview from './TaskIntentReview';

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
  const navigate = useWorkspaceAwareNavigate();
  const [priority, setPriority] = useState(0);
  const [assigneeAgentId, setAssigneeAgentId] = useState<string | undefined>(agentId);
  const [assigneeUserId, setAssigneeUserId] = useState<string | undefined>();
  const [instruction, setInstruction] = useState('');
  const [hasAttachments, setHasAttachments] = useState(false);
  // Default to workspace-visible (or the parent's visibility for subtasks).
  // In personal mode the chip is hidden and the value is never sent.
  const [visibility, setVisibility] = useState<'private' | 'public'>(defaultVisibility);

  // Reading the draft is what submit does now. It only stops for confirmation
  // when it found something the user alone can settle, so the escape hatch is
  // the dropdown's "create directly" rather than a setting nobody would find.
  const canCreateGoal = useUserStore(labPreferSelectors.enableTopicAcceptance);
  const [analysis, setAnalysis] = useState<TaskIntentAnalysis | null>(null);
  const [intentTitle, setIntentTitle] = useState('');
  const [intentAnswers, setIntentAnswers] = useState<ClarificationAnswers>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // The instruction the review step shows is a real editor, not a preview: it
  // is what gets created, so the user has to be able to read it and change it.
  // It is a second editor rather than the composer's own so that going back
  // returns to the untouched draft.
  // Set once the second reading has folded the answers into the instruction.
  // The appended Q&A block is then already redundant — leaving it on would put
  // the answers in the brief twice, once woven in and once as a list.
  const [isSynthesizing, setIsSynthesizing] = useState(false);

  // A private agent can only run a private task. Coerce + lock the
  // visibility chip when the selected agent is private.
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

  const resetComposer = useCallback(() => {
    setPriority(0);
    setAssigneeAgentId(agentId);
    setAssigneeUserId(undefined);
    setInstruction('');
    setVisibility(defaultVisibility);
    setAnalysis(null);
    setIntentAnswers({});
    editor?.cleanDocument?.();
    if (draftStorageKey) {
      try {
        localStorage.removeItem(draftStorageKey);
      } catch {
        /* ignore */
      }
    }
  }, [agentId, defaultVisibility, draftStorageKey, editor]);

  /** What the composer currently holds, or null when there is nothing to create. */
  const readDraft = useCallback(() => {
    const markdown = String(editor?.getDocument?.('markdown') ?? '').trim();
    const trimmedText = instruction.trim();
    const hasFiles = getAttachmentFileIdsFromEditor(editor).length > 0;
    if (!trimmedText && !markdown && !hasFiles) return null;

    const firstLine =
      trimmedText
        .split('\n')
        .find((line) => line.trim())
        ?.trim() ?? trimmedText;
    let name: string | undefined;
    if (firstLine) {
      name = firstLine.length > 30 ? `${firstLine.slice(0, 30)}…` : firstLine;
    }

    return {
      editorJson: editor?.getDocument?.('json') as unknown,
      instruction: markdown || trimmedText || name || '',
      name,
    };
  }, [editor, instruction]);

  const submitDraft = useCallback(
    async (draft: { editorJson: unknown; instruction: string; name?: string }) => {
      // Drop the persisted draft BEFORE the request, not in the success reset.
      // Creating the first task flips the list from empty to non-empty, which
      // swaps the hero composer for the one that sits above the list — a
      // different component instance, mounted while this await is still in
      // flight. That new instance hydrates itself from this key, so a draft
      // still on disk here comes straight back onto the screen and the reset
      // below lands on the old, dying instance. Kept in hand so a failed
      // create can put it back.
      let persistedDraft: string | null = null;
      if (draftStorageKey) {
        try {
          persistedDraft = localStorage.getItem(draftStorageKey);
          localStorage.removeItem(draftStorageKey);
        } catch {
          /* storage unavailable — persistence is best-effort */
        }
      }

      // `createTask` keeps its rejecting contract (other callers rely on `catch`);
      // handle the composer's own failure here so it isn't silent, keeping the
      // draft intact (the reset only runs on success).
      try {
        const result = await createTask({
          assigneeAgentId,
          assigneeUserId,
          editorData: draft.editorJson,
          instruction: draft.instruction,
          name: draft.name,
          parentTaskId,
          priority: priority || undefined,
          projectId,
          // Only send visibility in workspace mode; personal mode lets the server
          // fall through to the schema default ('public', inert in personal mode).
          visibility: activeWorkspaceId ? visibility : undefined,
        });

        if (result) {
          resetComposer();
          // Creating from here leaves the user on the list, so without this the
          // whole flow ends in a spinner blinking out — nothing says the task
          // exists, what it ended up called, or where it went. The name matters
          // most after a reading, since that name is what the reading produced.
          toast.success({
            // The open affordance rides in the description rather than the
            // action slot: the toast's job is to say the task exists, and a
            // filled button pulled to the far right read as the thing to do
            // next. The action slot is right-aligned and shrink-wrapped by the
            // toast itself, so lining the link up under the task name means
            // putting it in the same column as the name.
            description: (
              <Flexbox align={'flex-start'} gap={2}>
                <Text>{result.name || draft.name}</Text>
                <Button
                  size={'small'}
                  style={{ paddingInline: 0 }}
                  type={'text'}
                  onClick={() =>
                    navigate(taskDetailPath(result.identifier, result.assigneeAgentId ?? undefined))
                  }
                >
                  {t('taskIntent.openCreated')}
                </Button>
              </Flexbox>
            ),
            title: t('taskIntent.created'),
          });
          onCreated?.({
            agentId: result.assigneeAgentId ?? undefined,
            identifier: result.identifier,
          });
        }
      } catch {
        // Nothing was created, so the draft is still the user's work: put it
        // back on disk to match the text the composer is still showing.
        if (draftStorageKey && persistedDraft !== null) {
          try {
            localStorage.setItem(draftStorageKey, persistedDraft);
          } catch {
            /* storage unavailable — persistence is best-effort */
          }
        }
        toast.error(t('createTask.createFailed'));
      }
    },
    [
      t,
      activeWorkspaceId,
      draftStorageKey,
      assigneeAgentId,
      assigneeUserId,
      createTask,
      navigate,
      onCreated,
      parentTaskId,
      priority,
      projectId,
      resetComposer,
      visibility,
    ],
  );

  const handleSubmit = useCallback(async () => {
    if (!canCreateTask) return;
    const draft = readDraft();
    if (!draft) return;

    setIsAnalyzing(true);
    try {
      const result = await taskService.analyzeIntent({
        context: assigneeMeta?.title ? `Assigned agent: ${assigneeMeta.title}` : undefined,
        instruction: draft.instruction,
      });

      // An unambiguous draft is never held up — it goes straight through, just
      // with a real name instead of the first thirty characters of line one.
      if (shouldConfirmIntent(result)) {
        setAnalysis(result);
        setIntentTitle(result.title);
        setIntentAnswers({});
        return;
      }

      await submitDraft({ ...draft, name: result.title || draft.name });
    } catch {
      // Reading the draft is an assist, never a gate: when the model call fails
      // the task is created exactly as it would have been without this step.
      await submitDraft(draft);
    } finally {
      setIsAnalyzing(false);
    }
  }, [assigneeMeta?.title, canCreateTask, readDraft, submitDraft]);

  /**
   * The escape hatch, one click away in the submit dropdown: create the task
   * with no reading at all. Same path the composer took before this feature —
   * first line truncated for the name, draft text handed straight over — so a
   * user who finds the reading slow or wrong is never stuck behind it.
   */
  const handleCreateDirectly = useCallback(async () => {
    if (!canCreateTask) return;
    const draft = readDraft();
    if (!draft) return;
    await submitDraft(draft);
  }, [canCreateTask, readDraft, submitDraft]);

  const handleAnswerChange = useCallback((index: number, value: string) => {
    setIntentAnswers((current) => ({ ...current, [index]: value }));
  }, []);

  /**
   * The review editor is the source of truth for what gets created, not the
   * composer draft it was seeded from — the user may have rewritten any of it.
   * Markdown and its rich-text mirror are read from the same editor and get the
   * answers appended together, so the task page cannot show one and the agent
   * read the other.
   */
  /**
   * Generate and create, in one press.
   *
   * The first reading ran before the user answered, so its brief still names
   * the answered details as open — creating from it, or from it with the
   * answers stapled underneath, hands the executor a document that contradicts
   * itself. So pressing generate writes the brief again with the answers folded
   * in as settled facts, and creates the task from that. There is no page in
   * between: the brief is on the task's own page the moment it exists.
   *
   * Like the first reading it is an assist, never a gate — a failed rewrite
   * falls back to the draft with the answers appended, which is what the flow
   * did before this step existed.
   */
  const handleConfirmIntent = useCallback(async () => {
    const draft = readDraft();
    if (!analysis || !draft) return;

    const pairs = answeredClarifications(analysis, intentAnswers);

    if (pairs.length > 0) {
      setIsSynthesizing(true);
      try {
        const written = await taskService.synthesizeInstruction({
          answers: pairs,
          context: assigneeMeta?.title ? `Assigned agent: ${assigneeMeta.title}` : undefined,
          instruction: draft.instruction,
        });

        await submitDraft({
          // Freshly written prose has no mirror to inherit. Sending the
          // pre-answer draft's document instead would win over this markdown
          // when the task renders, showing a brief the agent never received.
          editorJson: undefined,
          instruction: written.instruction,
          name: written.title.trim() || intentTitle.trim() || analysis.title,
        });
        return;
      } catch {
        // Fall through to the append path below.
      } finally {
        setIsSynthesizing(false);
      }
    }

    const confirmed = buildConfirmedDraft({
      analysis,
      answers: intentAnswers,
      editorJson: draft.editorJson,
      heading: t('taskIntent.answersHeading'),
      instruction: draft.instruction,
    });

    await submitDraft({
      editorJson: confirmed.editorData,
      instruction: confirmed.instruction,
      name: intentTitle.trim() || analysis.title,
    });
  }, [analysis, assigneeMeta?.title, intentAnswers, intentTitle, readDraft, submitDraft, t]);

  // Hands the draft (and any answers already given) to the goal modal, then
  // drops back to composing: the goal flow owns the outcome from here, and the
  // untouched draft is still in the editor if the user backs out of it.
  const handleSwitchToGoal = useCallback(() => {
    const draft = readDraft();
    if (!analysis || !draft) return;

    const seed = buildGoalSeed({
      analysis,
      answers: intentAnswers,
      heading: t('taskIntent.answersHeading'),
      instruction: draft.instruction,
    });

    createGoalModal({
      agentId: assigneeAgentId,
      initialRequirement: seed.requirement,
      initialTitle: intentTitle.trim() || seed.title,
      onCreated: resetComposer,
      projectId,
    });
    setAnalysis(null);
  }, [
    analysis,
    assigneeAgentId,
    intentAnswers,
    intentTitle,
    projectId,
    readDraft,
    resetComposer,
    t,
  ]);

  const isReviewing = Boolean(analysis);

  // Cmd+Enter means "the primary action of what is on screen": submit the
  // draft while composing, confirm the reading while reviewing.
  const handleSubmitRef = useRef(handleSubmit);
  useEffect(() => {
    handleSubmitRef.current = isReviewing ? handleConfirmIntent : handleSubmit;
  }, [handleConfirmIntent, handleSubmit, isReviewing]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      void handleSubmitRef.current?.();
    }
  }, []);

  return (
    // The ring belongs to the whole input surface — editor, controls and submit
    // are one thing being read, so lighting only the text area would draw a
    // second boundary the composer does not otherwise have.
    <GeneratingBorder generating={isAnalyzing || isSynthesizing}>
      <Block
        style={{ overflow: 'hidden', position: 'relative' }}
        variant={'outlined'}
        onKeyDownCapture={handleKeyDown}
      >
        {!isHero && !isReviewing && (
          <ActionIcon
            icon={ChevronUp}
            size={'small'}
            style={{ position: 'absolute', right: 8, top: 8, zIndex: 1 }}
            title={t('createTask.collapse')}
            onClick={handleCollapse}
          />
        )}
        {isReviewing && analysis && (
          <TaskIntentReview
            analysis={analysis}
            answers={intentAnswers}
            isCreating={isCreating || isSynthesizing}
            title={intentTitle}
            onAnswerChange={handleAnswerChange}
            onBack={() => setAnalysis(null)}
            onConfirm={handleConfirmIntent}
            onSwitchToGoal={canCreateGoal ? handleSwitchToGoal : undefined}
            onTitleChange={setIntentTitle}
          />
        )}
        {/* Kept mounted through the review step so going back restores the draft
            exactly as it was, attachments and all. */}
        <Flexbox
          style={{
            display: isReviewing ? 'none' : undefined,
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
            display: isReviewing ? 'none' : undefined,
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
                          defaultValue:
                            'A task assigned to a member stays visible to the workspace.',
                        })
                      : undefined
                }
                onChange={setVisibility}
              >
                <TaskVisibilityChipLabel height={24} paddingBlock={3} visibility={visibility} />
              </TaskVisibilityTag>
            )}

            <Flexbox horizontal align={'center'} gap={2}>
              <Button
                loading={isCreating || isAnalyzing}
                shape={'round'}
                size={'small'}
                title={canCreateTask ? undefined : reason}
                // The shimmer is a text-clipped gradient in the foreground color, so
                // it only reads on a light surface. Dropping the filled style while
                // reading also matches what is happening: the button has handed the
                // draft off and is no longer the thing to press.
                type={isAnalyzing ? 'default' : 'primary'}
                disabled={
                  !canCreateTask ||
                  isCreating ||
                  isAnalyzing ||
                  (!instruction.trim() && !hasAttachments)
                }
                onClick={handleSubmit}
              >
                {isAnalyzing ? (
                  // Same shimmer every other "a model is working on this" label in
                  // the app uses, so the wait reads as the product thinking rather
                  // than as the button having gone inert.
                  <span className={shinyTextStyles.shinyText}>{t('taskIntent.analyzing')}</span>
                ) : (
                  t('createTask.submit')
                )}
              </Button>
              {/* The escape hatch sits on the button it bypasses, so a user who
                  does not want the reading finds it exactly where they already
                  are — rather than in a setting they would have to know exists. */}
              <DropdownMenu
                placement={'bottomRight'}
                items={[
                  {
                    key: 'create-directly',
                    label: t('taskIntent.createDirectly'),
                    onClick: () => void handleCreateDirectly(),
                  },
                ]}
              >
                <ActionIcon
                  icon={ChevronDown}
                  size={'small'}
                  title={t('taskIntent.moreCreateOptions')}
                  disabled={
                    !canCreateTask ||
                    isCreating ||
                    isAnalyzing ||
                    (!instruction.trim() && !hasAttachments)
                  }
                />
              </DropdownMenu>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      </Block>
    </GeneratingBorder>
  );
});

export default CreateTaskInlineEntry;
