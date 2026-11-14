'use client';

import { cssVar as lobeCssVar, Flexbox, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useSize } from 'ahooks';
import { PlusIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useUploadFiles } from '@/components/DragUploadZone';
import {
  type ActionKeys,
  ChatInputProvider,
  DesktopChatInput,
  type SendButtonHandler,
} from '@/features/ChatInput';
import FileUpload from '@/features/ChatInput/ActionBar/Upload';
import InputDragUpload from '@/features/Home/InputArea/InputDragUpload';
import ModeSelect from '@/features/Home/InputArea/ModeSelect';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import type { ProjectDetail } from '@/store/project';

import { useCanManageProject } from '../useCanManageProject';
import ProjectAgentSelect from './ProjectAgentSelect';
import { projectComposerAgents } from './projectComposerAgents';
import ProjectWorkLocationPicker from './ProjectWorkLocationPicker';
import {
  AttachmentsNotReadyError,
  DirectoryUnavailableError,
  getProjectComposerContextKey,
  type ProjectComposerMode,
  useProjectComposer,
} from './useProjectComposer';
import { useProjectDirectory } from './useProjectDirectory';
import { useProjectRepository } from './useProjectRepository';
import { useProjectWorkLocation } from './useProjectWorkLocation';

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
  const workspaceId = useActiveWorkspaceId();
  // A workspace-public agent applies published environments only.
  const sharedAgent = useAgentStore(
    (s) => !!workspaceId && s.agentMap[agentId]?.visibility === 'public',
  );
  const repositoryState = useProjectRepository(project.id, sharedAgent);
  const canManageProject = useCanManageProject();
  const location = useProjectWorkLocation(agentId);
  const directoryState = useProjectDirectory(project.id, location.machineDeviceId);
  // A task is not started in a conversation, so it has no repository or folder to pick.
  const place =
    mode !== 'chat'
      ? {}
      : location.target === 'sandbox'
        ? { environmentId: repositoryState.repository?.id }
        : { directoryId: directoryState.directory?.id };
  const { send, sending } = useProjectComposer(project, mode, agentId, place);

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
      if (error instanceof DirectoryUnavailableError) {
        toast.error(t('overview.context.location.directoryUnavailable'));
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
            <ModeSelect value={mode} onChange={setMode} />
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
            <ProjectWorkLocationPicker
              canManage={canManageProject}
              compact={compact}
              directoryState={directoryState}
              disabled={sending}
              location={location}
              projectId={project.id}
              publish={sharedAgent}
              showRepositories={mode === 'chat'}
              state={repositoryState}
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
