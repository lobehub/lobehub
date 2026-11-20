import {
  AGENT_DOCUMENT_CATEGORY,
  AGENT_DOCUMENT_WEB_CATEGORY,
  buildAgentSkillIdentifier,
  EMPTY_ARRAY,
} from '@lobechat/const';
import { ActionIcon, Center, confirmModal, Empty, Flexbox, Spin, Text, toast } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { LucideIcon } from 'lucide-react';
import { FileTextIcon, GlobeIcon, Trash2Icon } from 'lucide-react';
import type { CSSProperties, DragEvent, MouseEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import { withErrorBoundary } from '@/components/ErrorBoundary';
import { SkeletonList } from '@/components/Skeleton/NavPanel/List';
import { buildAgentDocumentPath } from '@/features/AgentDocumentPage/navigation';
import {
  type AgentDocumentListMutator,
  DocumentExplorerTree,
} from '@/features/AgentDocumentsExplorer';
import { buildAgentProfileTabPath } from '@/features/AgentProfileTabs/tabOptions';
import { startSkillDrag } from '@/features/ChatInput/InputEditor/ActionTag/skillDragData';
import { startDocumentDrag } from '@/features/ChatInput/InputEditor/ReferDocument/documentDragData';
import {
  filterSkillItems,
  type SkillListItem,
  SkillSection,
  SkillsList,
  SkillsSearchBar,
  useProjectSkills,
} from '@/features/SkillsList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { agentDocumentService } from '@/services/agentDocument';
import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import {
  agentDocumentActions,
  agentDocumentSelectors,
  useAgentDocumentStore,
} from '@/store/agentDocument';
import { useChatStore } from '@/store/chat';
import { useDensityTokens } from '@/styles/density';
import { densityTokens, sidebarRow } from '@/styles/density.stylex';
import { standardizeIdentifier } from '@/utils/identifier';

import DeviceLevelSkills from './DeviceLevelSkills';
import { webDocumentRowMarker } from './markers.stylex';
import ProjectLevelSkills from './ProjectLevelSkills';
import { useCanManageUserSkills } from './useCanManageUserSkills';
import UserLevelSkills, { useUserSkills } from './UserLevelSkills';
import { useSelectSkill } from './useSelectSkill';

dayjs.extend(relativeTime);

export type ResourceFilter = 'skills' | 'documents' | 'web';
type DocumentOpenMode = 'portal' | 'route';

const styles = stylex.create({
  row: {
    cursor: 'pointer',
    position: 'relative',
    display: 'flex',
    gap: sidebarRow.gap,
    alignItems: 'flex-start',
    paddingBlock: '5px',
    paddingInline: sidebarRow.paddingInline,
    borderRadius: sidebarRow.radius,
    color: cssVar.colorText,
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  rowActive: {
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillSecondary },
  },
  rowIcon: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: sidebarRow.iconBox,
    height: sidebarRow.textLineHeight,
    color: cssVar.colorTextTertiary,
  },
  rowText: { display: 'flex', flex: '1', flexDirection: 'column', minWidth: 0 },
  rowTitle: {
    overflow: 'hidden',
    paddingInlineEnd: {
      default: 0,
      [stylex.when.ancestor(':hover', webDocumentRowMarker)]:
        `calc(24px + ${sidebarRow.paddingInline})`,
      [stylex.when.ancestor(':focus-within', webDocumentRowMarker)]:
        `calc(24px + ${sidebarRow.paddingInline})`,
    },
    fontSize: sidebarRow.textFontSize,
    lineHeight: sidebarRow.textLineHeight,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowMeta: {
    fontSize: sidebarRow.metaFontSize,
    lineHeight: '18px',
    color: cssVar.colorTextTertiary,
  },
  rowActions: {
    position: 'absolute',
    insetBlockStart: '3px',
    insetInlineEnd: sidebarRow.paddingInline,
    pointerEvents: {
      default: 'none',
      [stylex.when.ancestor(':hover', webDocumentRowMarker)]: 'auto',
      [stylex.when.ancestor(':focus-within', webDocumentRowMarker)]: 'auto',
    },
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', webDocumentRowMarker)]: 1,
      [stylex.when.ancestor(':focus-within', webDocumentRowMarker)]: 1,
    },
    transition: 'opacity 0.12s',
  },
  pillActive: {
    fontWeight: 500,
    color: cssVar.colorText,
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
  },
  pillTab: {
    cursor: 'pointer',
    userSelect: 'none',
    paddingBlock: '4px',
    paddingInline: densityTokens['--lobe-density-content-gap'],
    borderRadius: '999px',
    fontSize: '12px',
    lineHeight: 1.4,
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: `background ${cssVar.motionDurationFast} ${cssVar.motionEaseInOut},
      color ${cssVar.motionDurationFast} ${cssVar.motionEaseInOut}`,
  },
});

const FILTER_OPTIONS = [
  { labelKey: 'workingPanel.resources.filter.skills', value: 'skills' },
  { labelKey: 'workingPanel.resources.filter.documents', value: 'documents' },
  { labelKey: 'workingPanel.resources.filter.web', value: 'web' },
] as const satisfies readonly { labelKey: string; value: ResourceFilter }[];

const DOCUMENT_MODE_FILTER_OPTIONS = [
  { labelKey: 'workingPanel.resources.filter.documents', value: 'documents' },
  { labelKey: 'workingPanel.resources.filter.skills', value: 'skills' },
] as const satisfies readonly { labelKey: string; value: ResourceFilter }[];

type AgentDocumentListItem = Awaited<ReturnType<typeof agentDocumentService.listDocuments>>[number];

interface DocumentItemProps {
  activeDocumentIdentifier?: string;
  agentId: string;
  document: AgentDocumentListItem;
  hideDelete?: boolean;
  mutate: () => Promise<unknown>;
  onCurrentDeleted?: () => void;
  onOpenDocument: (documentId: string, agentDocumentId?: string) => void;
}

const DocumentItem = memo<DocumentItemProps>(
  ({
    activeDocumentIdentifier,
    agentId,
    document,
    hideDelete = false,
    mutate,
    onCurrentDeleted,
    onOpenDocument,
  }) => {
    const { t } = useTranslation(['chat', 'common']);
    const { iconSize } = useDensityTokens();

    const [deleting, setDeleting] = useState(false);

    const title = document.title || document.filename || '';
    const description = document.description ?? undefined;
    const isWeb = document.sourceType === 'web';
    const IconComponent: LucideIcon = isWeb ? GlobeIcon : FileTextIcon;
    const updatedAtLabel = document.updatedAt
      ? t('workingPanel.resources.updatedAt', {
          ns: 'chat',
          time: dayjs(document.updatedAt).fromNow(),
        })
      : null;

    const isActive = activeDocumentIdentifier === standardizeIdentifier(document.documentId);

    const handleOpen = () => {
      if (!document.documentId) return;
      onOpenDocument(document.documentId, document.id);
    };

    const handleDelete = (e: MouseEvent) => {
      e.stopPropagation();
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('workingPanel.resources.deleteConfirm', { ns: 'chat' }),
        okButtonProps: { danger: true },
        okText: t('delete', { ns: 'common' }),
        onOk: async () => {
          setDeleting(true);
          try {
            await agentDocumentService.removeDocument({
              agentId,
              documentId: document.documentId,
              id: document.id,
              withChildren: true,
            });
            await mutate();
            if (isActive) onCurrentDeleted?.();
            toast.success(t('workingPanel.resources.deleteSuccess', { ns: 'chat' }));
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : t('workingPanel.resources.deleteError', { ns: 'chat' }),
            );
          } finally {
            setDeleting(false);
          }
        },
        title: t('workingPanel.resources.deleteTitle', { ns: 'chat' }),
      });
    };

    const meta = [description, updatedAtLabel].filter(Boolean).join(' · ');

    return (
      <div
        {...stylex.props(styles.row, isActive && styles.rowActive, webDocumentRowMarker)}
        onClick={handleOpen}
      >
        <span {...stylex.props(styles.rowIcon)}>
          <IconComponent size={iconSize} />
        </span>
        <span {...stylex.props(styles.rowText)}>
          <span {...stylex.props(styles.rowTitle)} title={title}>
            {title}
          </span>
          {meta && (
            <Text className={stylex.props(styles.rowMeta).className} ellipsis={{ rows: 2 }}>
              {meta}
            </Text>
          )}
        </span>
        {!hideDelete && (
          <span {...stylex.props(styles.rowActions)}>
            <ActionIcon
              icon={Trash2Icon}
              loading={deleting}
              size={'small'}
              title={t('delete', { ns: 'common' })}
              onClick={handleDelete}
            />
          </span>
        )}
      </div>
    );
  },
);

DocumentItem.displayName = 'AgentDocumentsGroupItem';

interface SkillBundleView {
  bundle: AgentDocumentListItem;
  files: string[];
  pathToDocumentId: Map<string, string>;
}

const buildSkillBundleViews = (data: AgentDocumentListItem[]): SkillBundleView[] => {
  const childrenByParent = new Map<string, AgentDocumentListItem[]>();
  for (const doc of data) {
    if (!doc.parentId) continue;
    const list = childrenByParent.get(doc.parentId) ?? [];
    list.push(doc);
    childrenByParent.set(doc.parentId, list);
  }

  return data
    .filter((doc) => doc.isSkillBundle)
    .map((bundle) => {
      const files: string[] = [];
      const pathToDocumentId = new Map<string, string>();

      const walk = (parentDocId: string, prefix: string) => {
        const children = childrenByParent.get(parentDocId) ?? [];
        for (const child of children) {
          const name = child.filename || child.title || 'untitled';
          const relPath = prefix ? `${prefix}/${name}` : name;
          if (child.isFolder) {
            walk(child.documentId, relPath);
          } else {
            files.push(relPath);
            pathToDocumentId.set(relPath, child.documentId);
          }
        }
      };
      walk(bundle.documentId, '');

      return { bundle, files, pathToDocumentId };
    });
};

interface AgentDocumentsGroupProps {
  activeFilter?: ResourceFilter;
  /** The WorkingSidebar row system for the document tree and the loading / error states. */
  compact?: boolean;
  /** Bound remote device id (device mode); skills are then scanned over RPC. */
  deviceId?: string;
  /**
   * Gate the (unbounded) document-list fetch. Defaults to `true`. The working
   * sidebar passes `false` while its panel is collapsed so entering a
   * conversation no longer pulls the full list into the initial batch — it
   * fetches only once the user actually opens the resources panel.
   */
  enabled?: boolean;
  openMode?: DocumentOpenMode;
  showFilterTabs?: boolean;
  showLocalProjectSkills?: boolean;
  style?: CSSProperties;
  workingDirectory?: string;
}

const AgentDocumentsGroup = memo<AgentDocumentsGroupProps>(
  ({
    activeFilter: controlledFilter,
    compact,
    deviceId,
    enabled = true,
    openMode,
    showFilterTabs = true,
    showLocalProjectSkills = false,
    style,
    workingDirectory,
  }) => {
    const { t } = useTranslation('chat');

    const agentId = useAgentStore((s) => s.activeAgentId);
    const canManageUserSkills = useCanManageUserSkills(agentId || '');
    const { docId } = useParams<{ docId?: string }>();
    const navigate = useWorkspaceAwareNavigate();
    const openDocument = useChatStore((s) => s.openDocument);
    const isDocumentMode = !!docId;
    const canManageSkills = !isDocumentMode && canManageUserSkills;
    const resolvedOpenMode = openMode ?? (isDocumentMode ? 'route' : 'portal');
    const isLocalEnabled = useAgentStore((s) =>
      agentId ? chatConfigByIdSelectors.isLocalSystemEnabledById(agentId)(s) : false,
    );
    const [filter, setFilter] = useState<ResourceFilter>(() =>
      isDocumentMode ? 'documents' : 'skills',
    );
    const [skillSearchQuery, setSkillSearchQuery] = useState('');
    const activeDocumentIdentifier = docId ? standardizeIdentifier(docId) : undefined;
    const filterOptions = isDocumentMode ? DOCUMENT_MODE_FILTER_OPTIONS : FILTER_OPTIONS;
    const resolvedFilter = controlledFilter ?? filter;
    const activeFilter = filterOptions.some((option) => option.value === resolvedFilter)
      ? resolvedFilter
      : filterOptions[0].value;

    useEffect(() => {
      if (controlledFilter) return;
      setFilter(isDocumentMode ? 'documents' : 'skills');
    }, [controlledFilter, isDocumentMode]);

    // Local desktop reads skills over IPC; a bound device reads over RPC.
    // `enabled` is false while the pane sits hidden behind `<Activity>`. Without it
    // a closed panel still ran the filesystem skill scan and mounted a row subtree
    // per skill — thousands of zero-box components the user never sees.
    const showProjectSkills =
      enabled && (showLocalProjectSkills || isLocalEnabled || !!deviceId) && !!workingDirectory;

    // Mirror what each child component reads so the parent can decide the
    // section layout (flat when a single source has items, sectioned otherwise).
    // Both hooks are SWR-deduped against their respective child fetches.
    // Include disabled inventory so the management entry survives disabling every skill.
    const userSkillItems = useUserSkills(enabled, canManageSkills);
    const {
      deviceItems: deviceSkillItems,
      error: projectSkillsError,
      isLoading: isProjectSkillsLoading,
      projectItems: projectSkillItems,
    } = useProjectSkills(showProjectSkills ? workingDirectory : undefined, deviceId);

    // The agent's document-list replica: on a reload the persisted list paints
    // the panel at once and the network only confirms it.
    const { error: listError } = agentDocumentActions.useFetchDocumentList(agentId, { enabled });
    const list = useAgentDocumentStore(agentDocumentSelectors.getDocumentList(agentId));
    const data = list ?? EMPTY_ARRAY;
    // Loading / error take over the panel only while there is nothing to show.
    const isLoading = !list && !listError;
    const error = list ? undefined : listError;
    const mutate = useCallback<AgentDocumentListMutator>(
      (edit, options) =>
        agentId
          ? agentDocumentActions.mutateDocumentList(agentId, edit, options)
          : Promise.resolve(),
      [agentId],
    );

    const webData = useMemo(
      () => data.filter((doc) => doc.category === AGENT_DOCUMENT_WEB_CATEGORY),
      [data],
    );

    const documentsData = useMemo(
      () => data.filter((doc) => doc.category === AGENT_DOCUMENT_CATEGORY),
      [data],
    );

    const skillBundleViews = useMemo(() => buildSkillBundleViews(data), [data]);

    const skillItems = useMemo<SkillListItem[]>(
      () =>
        skillBundleViews.map(({ bundle, files }) => ({
          description: bundle.description ?? undefined,
          files,
          id: bundle.documentId,
          name: bundle.title || bundle.filename || '',
        })),
      [skillBundleViews],
    );

    const matchedSkillItems = useMemo(
      () => filterSkillItems(skillItems, skillSearchQuery),
      [skillItems, skillSearchQuery],
    );

    const openAgentDocument = useCallback(
      (documentId: string, agentDocumentId?: string) => {
        if (!agentId) return;
        if (resolvedOpenMode === 'portal') {
          openDocument(
            documentId,
            agentDocumentId ?? data.find((doc) => doc.documentId === documentId)?.id,
          );
          return;
        }
        navigate(buildAgentDocumentPath(agentId, documentId));
      },
      [agentId, data, navigate, openDocument, resolvedOpenMode],
    );

    // Dragging a document into the chat input inserts a `<refer_document>` chip;
    // the server resolves it against this agent's documents when sending.
    const handleDocumentDragStart = useCallback(
      (doc: { filename?: string | null; id: string; title?: string | null }, event: DragEvent) => {
        startDocumentDrag(event, { documentId: doc.id, title: doc.title || doc.filename || '' });
      },
      [],
    );

    // Open the SKILL.md (skills/index child) when present; fall back to the
    // bundle itself (orphan bundles surface for recovery).
    const openAgentSkill = useCallback(
      (item: SkillListItem) => {
        const view = skillBundleViews.find((v) => v.bundle.documentId === item.id);
        const indexChild = data.find((doc) => doc.parentId === item.id && doc.isSkillIndex);
        const targetDocId = indexChild?.documentId ?? view?.bundle.documentId ?? item.id;
        openAgentDocument(targetDocId);
      },
      [data, openAgentDocument, skillBundleViews],
    );

    const openAgentSkillFile = useCallback(
      (item: SkillListItem, relativePath: string) => {
        const view = skillBundleViews.find((v) => v.bundle.documentId === item.id);
        const childDocId = view?.pathToDocumentId.get(relativePath);
        if (!childDocId) return;
        openAgentDocument(childDocId);
      },
      [openAgentDocument, skillBundleViews],
    );

    const getAgentSkillIdentifier = useCallback(
      (item: SkillListItem) => {
        const filename = skillBundleViews.find((view) => view.bundle.documentId === item.id)?.bundle
          .filename;
        return filename ? buildAgentSkillIdentifier(filename) : undefined;
      },
      [skillBundleViews],
    );
    const selectAgentSkill = useSelectSkill('agentSkill', getAgentSkillIdentifier);

    // The runtime resolves these via the `agent-skills:<filename>` identifier
    // (built from the shared const helper so the prefix stays in lockstep with
    // the server-side resolver). Display label keeps the human-readable title.
    const handleAgentSkillDragStart = useCallback(
      (item: SkillListItem, event: DragEvent) => {
        const type = getAgentSkillIdentifier(item);
        if (!type) return;
        startSkillDrag(event, {
          category: 'agentSkill',
          label: item.name,
          type,
        });
      },
      [getAgentSkillIdentifier],
    );

    if (!agentId) return null;

    if (isLoading) {
      if (compact) return <SkeletonList compact rows={6} />;
      return (
        <Center flex={1} paddingBlock={24}>
          <Spin size="large" />
        </Center>
      );
    }

    if (error) {
      if (compact)
        return (
          <AsyncError
            align={'start'}
            error={error}
            variant={'inline'}
            onRetry={() => {
              void mutate();
            }}
          />
        );
      return (
        <Center flex={1} paddingBlock={24}>
          <AsyncError
            error={error}
            variant={'block'}
            onRetry={() => {
              void mutate();
            }}
          />
        </Center>
      );
    }

    const backToChat = () => {
      if (!agentId) return;
      navigate(`/agent/${agentId}`);
    };

    const renderAgentSkillsList = () => (
      <SkillsList
        compact
        items={matchedSkillItems}
        onOpenFile={openAgentSkillFile}
        onOpenSkill={openAgentSkill}
        onSelectSkill={isDocumentMode ? undefined : selectAgentSkill}
        onSkillDragStart={handleAgentSkillDragStart}
      />
    );

    const renderSkills = () => {
      // This is an invocation picker for agent/project/device/user skills, not a
      // full capability inventory. Builtin bundles intentionally keep their existing
      // slash/profile entry points instead of being copied into this sidebar.
      // Sections render in fixed order — agent → project → device → user — and each one
      // hides itself when it has nothing to show. When exactly one source has
      // items we drop the group header and render the list flat (no redundant
      // "User skills 1" label above a single row). When everything is empty we
      // fall back to a single placeholder.
      const hasAgent = skillItems.length > 0;
      const hasProject = showProjectSkills && projectSkillItems.length > 0;
      const hasDevice = showProjectSkills && deviceSkillItems.length > 0;
      const hasUser = userSkillItems.length > 0;
      const activeCount =
        (hasAgent ? 1 : 0) + (hasProject ? 1 : 0) + (hasDevice ? 1 : 0) + (hasUser ? 1 : 0);

      if (activeCount === 0) {
        if (showProjectSkills && projectSkillsError) {
          return <AsyncError align={'start'} error={projectSkillsError} variant={'inline'} />;
        }

        // Project skills refetch on a working-directory switch (new SWR key →
        // empty items while in flight). Show the loader instead of flashing the
        // empty placeholder when there's nothing else to render yet.
        if (showProjectSkills && isProjectSkillsLoading) {
          return <SkeletonList compact rows={6} />;
        }
        return (
          <Center flex={1} paddingBlock={24}>
            <Empty description={t('workingPanel.skills.empty')} icon={SkillsIcon} />
          </Center>
        );
      }

      // `flat` keys off the unfiltered sources so typing doesn't make headers jump.
      const flat = activeCount === 1;
      const hasMatchedAgent = matchedSkillItems.length > 0;
      const hasMatchedProject =
        hasProject && filterSkillItems(projectSkillItems, skillSearchQuery).length > 0;
      const hasMatchedDevice =
        hasDevice && filterSkillItems(deviceSkillItems, skillSearchQuery).length > 0;
      const hasMatchedUser = filterSkillItems(userSkillItems, skillSearchQuery).length > 0;
      const hasMatch = hasMatchedAgent || hasMatchedProject || hasMatchedDevice || hasMatchedUser;

      return (
        <Flexbox gap={12}>
          <SkillsSearchBar onSearch={setSkillSearchQuery} />
          {!hasMatch && !(hasUser && canManageSkills) && (
            <Center flex={1} paddingBlock={24}>
              <Empty description={t('workingPanel.skills.noSearchResults')} icon={SkillsIcon} />
            </Center>
          )}
          {hasMatchedAgent &&
            (flat ? (
              renderAgentSkillsList()
            ) : (
              <SkillSection
                compact
                sectionHeader={{
                  count: matchedSkillItems.length,
                  title: t('workingPanel.skills.section.agent'),
                }}
              >
                {renderAgentSkillsList()}
              </SkillSection>
            ))}
          {hasMatchedProject && (
            <ProjectLevelSkills
              deviceId={deviceId}
              hideHeader={flat}
              searchQuery={skillSearchQuery}
              workingDirectory={workingDirectory!}
            />
          )}
          {hasMatchedDevice && (
            <DeviceLevelSkills
              deviceId={deviceId}
              hideHeader={flat}
              searchQuery={skillSearchQuery}
              workingDirectory={workingDirectory!}
            />
          )}
          {hasUser && (
            <UserLevelSkills
              hideHeader={flat}
              searchQuery={skillSearchQuery}
              onManage={
                canManageSkills
                  ? () => navigate(buildAgentProfileTabPath(agentId, 'skills'))
                  : undefined
              }
            />
          )}
        </Flexbox>
      );
    };

    const renderDocuments = () => (
      // Always render the tree for the Documents tab even when empty, so the
      // toolbar (new folder / new doc) stays reachable.
      <Flexbox flex={1} style={{ minHeight: 0 }}>
        <DocumentExplorerTree
          agentId={agentId}
          data={documentsData}
          density={compact ? 'compact' : 'default'}
          mutate={mutate}
          style={{ height: '100%' }}
          onDocumentDragStart={handleDocumentDragStart}
          onOpenDocument={openAgentDocument}
        />
      </Flexbox>
    );

    const renderWeb = () => {
      if (webData.length === 0) {
        return (
          <Center flex={1} paddingBlock={24}>
            <Empty description={t('workingPanel.resources.empty')} icon={GlobeIcon} />
          </Center>
        );
      }
      return (
        <Flexbox gap={1}>
          {webData.map((doc) => (
            <DocumentItem
              activeDocumentIdentifier={activeDocumentIdentifier}
              agentId={agentId}
              document={doc}
              key={doc.id}
              mutate={mutate}
              onCurrentDeleted={backToChat}
              onOpenDocument={openAgentDocument}
            />
          ))}
        </Flexbox>
      );
    };

    return (
      <Flexbox gap={12} style={style}>
        {showFilterTabs && (
          <Flexbox horizontal gap={4} role={'tablist'}>
            {filterOptions.map((option) => {
              const active = activeFilter === option.value;
              return (
                <div
                  aria-selected={active}
                  {...stylex.props(styles.pillTab, active && styles.pillActive)}
                  key={option.value}
                  role={'tab'}
                  onClick={() => setFilter(option.value)}
                >
                  {t(option.labelKey)}
                </div>
              );
            })}
          </Flexbox>
        )}
        {activeFilter === 'skills' && renderSkills()}
        {activeFilter === 'documents' && renderDocuments()}
        {activeFilter === 'web' && renderWeb()}
      </Flexbox>
    );
  },
);

AgentDocumentsGroup.displayName = 'AgentDocumentsGroup';

export default withErrorBoundary(AgentDocumentsGroup, { variant: 'alert' });
