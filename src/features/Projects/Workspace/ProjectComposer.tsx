'use client';

import { ActionIcon, cssVar as lobeCssVar, Flexbox, Segmented, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useSize } from 'ahooks';
import { PlusIcon, SettingsIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUploadFiles } from '@/components/DragUploadZone';
import {
  type ActionKeys,
  ChatInputProvider,
  DesktopChatInput,
  type SendButtonHandler,
} from '@/features/ChatInput';
import FileUpload from '@/features/ChatInput/ActionBar/Upload';
import InputDragUpload from '@/features/Home/InputArea/InputDragUpload';
import { getProjectSettingsPath } from '@/features/Projects/Layout/navigation';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import type { ProjectDetail } from '@/store/project';

import { useCanManageProject } from '../useCanManageProject';
import ProjectAgentSelect from './ProjectAgentSelect';
import { projectComposerAgents } from './projectComposerAgents';
import ProjectRepositoryChip from './ProjectRepositoryChip';
import ProjectRunTargetChip from './ProjectRunTargetChip';
import {
  AttachmentsNotReadyError,
  getProjectComposerContextKey,
  type ProjectComposerMode,
  useProjectComposer,
} from './useProjectComposer';
import { useProjectRepository } from './useProjectRepository';

const leftActions: ActionKeys[] = [];
const rightActions: ActionKeys[] = [];

const CONTAINER_RADIUS = 18;
/** Clearance from the container edge to the round controls sitting in its corners. */
const ACTION_BAR_INSET = 8;

const inputContainerProps = {
  minHeight: 88,
  resize: false,
  style: {
    borderRadius: CONTAINER_RADIUS,
    boxShadow: lobeCssVar.boxShadowSecondary,
  },
};

/** How far the composer reaches up over the context tray behind it. */
const TRAY_OVERLAP = CONTAINER_RADIUS;
/**
 * Below this width the tray drops its labels and keeps the icons, with the
 * names in tooltips. Shrinking labels one by one could not keep every control
 * whole in a narrow window; this always fits.
 */
const COMPACT_TRAY_WIDTH = 500;

const styles = stylex.create({
  // The composer sits in front of the tray. The tray is inset by more than the
  // composer's corner radius on each side, so it only ever meets the
  // composer's straight top edge and reads as one piece tucked behind it.
  card: {
    position: 'relative',
    zIndex: 1,
    marginBlockStart: `-${TRAY_OVERLAP}px`,
  },
  // The inset is the frame's padding, not the tray's margin: the tray fills its
  // parent's width, and a margin would push it past the composer's right edge.
  trayFrame: {
    paddingInline: '24px',
  },
  // The left side gives way in a narrow window (the agent's name truncates);
  // where the work happens, on the right, always stays whole.
  trayLeading: {
    flex: '1',
    minWidth: 0,
  },
  trayTrailing: {
    flexShrink: 0,
  },
  tray: {
    gap: '8px',
    paddingBlockStart: '8px',
    paddingBlockEnd: `${TRAY_OVERLAP + 8}px`,
    paddingInline: '10px',
    borderStartStartRadius: '20px',
    borderStartEndRadius: '20px',
    backgroundColor: cssVar.colorFillTertiary,
  },
});

const actionBarStyle = { paddingBlockEnd: ACTION_BAR_INSET, paddingInline: ACTION_BAR_INSET };

export interface ProjectComposerRequest {
  at: number;
  mode: ProjectComposerMode;
}

interface ProjectComposerProps {
  detail: ProjectDetail;
  request?: ProjectComposerRequest;
}

/**
 * The project home composer is the regular chat input — line breaks, pasted
 * images and attachments behave as in any conversation — sending to a
 * project agent (the main agent unless another is picked), or recording a task
 * for it.
 */
const ProjectComposer = memo<ProjectComposerProps>(({ detail, request }) => {
  const { project } = detail;
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation('project');
  const { t: tHome } = useTranslation('home');
  const navigate = useWorkspaceAwareNavigate();
  const trayRef = useRef<HTMLDivElement>(null);
  const traySize = useSize(trayRef);
  const compact = !!traySize && traySize.width < COMPACT_TRAY_WIDTH;
  const [mode, setMode] = useState<ProjectComposerMode>('chat');

  const [handledRequest, setHandledRequest] = useState(request);
  if (request !== handledRequest) {
    setHandledRequest(request);
    if (request) setMode(request.mode);
  }

  useEffect(() => {
    if (!request) return;
    const container = containerRef.current;
    container?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    container?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
  }, [request]);
  const agents = useMemo(() => projectComposerAgents(detail), [detail]);
  const [pickedAgentId, setPickedAgentId] = useState<string>();
  // A pick that left the project (disabled or removed) falls back to the main agent.
  const agentId =
    agents.find((agent) => agent.id === pickedAgentId)?.id ?? project.coordinatorAgentId;
  const repositoryState = useProjectRepository(project.id);
  const canManageProject = useCanManageProject();
  // A task is not started in a conversation, so it has no repository to pick.
  const environmentId = mode === 'chat' ? repositoryState.repository?.id : undefined;
  const { send, sending } = useProjectComposer(project, mode, agentId, environmentId);

  useInitAgentConfig(agentId);
  const isAgentConfigLoading = useAgentStore((s) =>
    agentByIdSelectors.isAgentConfigLoadingById(agentId)(s),
  );
  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(agentId)(s));
  const provider = useAgentStore((s) => agentByIdSelectors.getAgentModelProviderById(agentId)(s));
  const contextSelectionKey = getProjectComposerContextKey(project.id);
  const { handleUploadFiles } = useUploadFiles({
    agentId,
    contextKey: contextSelectionKey,
    model,
    provider,
  });

  const submit: SendButtonHandler = async (params) => {
    try {
      await send(params);
    } catch (error) {
      if (error instanceof AttachmentsNotReadyError) {
        toast.error(tHome('dashboard.task.attachmentsNotReady'));
        return;
      }
      console.error('Failed to send from the project home', error);
      toast.error(t(mode === 'task' ? 'overview.createTaskFailed' : 'overview.sendFailed'));
    }
  };

  const sendButtonProps = useMemo(
    () => ({
      disabled: sending || isAgentConfigLoading,
      generating: sending,
      onStop: () => {},
      shape: 'round' as const,
    }),
    [sending, isAgentConfigLoading],
  );

  return (
    <div ref={containerRef}>
      <div ref={trayRef} {...stylex.props(styles.trayFrame)}>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.tray).className}
          justify={'space-between'}
        >
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.trayLeading).className}
            gap={4}
          >
            <Segmented
              size={'small'}
              value={mode}
              options={[
                { label: t('overview.mode.chat'), value: 'chat' },
                { label: t('overview.mode.task'), value: 'task' },
              ]}
              onChange={(value) => setMode(value as ProjectComposerMode)}
            />
            <ProjectAgentSelect
              agents={agents}
              compact={compact}
              disabled={sending}
              value={agentId}
              onChange={setPickedAgentId}
            />
          </Flexbox>
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.trayTrailing).className}
            gap={2}
          >
            {mode === 'chat' && (
              <ProjectRepositoryChip
                canManage={canManageProject}
                compact={compact}
                disabled={sending}
                projectId={project.id}
                state={repositoryState}
              />
            )}
            <ProjectRunTargetChip agentId={agentId} compact={compact} disabled={sending} />
            <ActionIcon
              aria-label={t('overview.context.settings')}
              icon={SettingsIcon}
              size={'small'}
              title={t('overview.context.settings')}
              onClick={() =>
                navigate(getProjectSettingsPath(project.slug ?? project.id, 'environments'))
              }
            />
          </Flexbox>
        </Flexbox>
      </div>
      <div {...stylex.props(styles.card)}>
        <InputDragUpload radius={CONTAINER_RADIUS} onUploadFiles={handleUploadFiles}>
          <ChatInputProvider
            agentId={agentId}
            allowExpand={false}
            contextSelectionKey={contextSelectionKey}
            leftActions={leftActions}
            rightActions={rightActions}
            sendButtonProps={sendButtonProps}
            slashPlacement="bottom"
            topicId={null}
            onSend={submit}
          >
            <DesktopChatInput
              actionBarStyle={actionBarStyle}
              dropdownPlacement="bottomLeft"
              inputContainerProps={inputContainerProps}
              leftContent={<FileUpload icon={PlusIcon} includeKnowledge={false} />}
              showControlBar={false}
              placeholder={t(
                mode === 'task' ? 'overview.taskPlaceholder' : 'overview.composerPlaceholder',
              )}
            />
          </ChatInputProvider>
        </InputDragUpload>
      </div>
    </div>
  );
});

ProjectComposer.displayName = 'ProjectComposer';

export default ProjectComposer;
