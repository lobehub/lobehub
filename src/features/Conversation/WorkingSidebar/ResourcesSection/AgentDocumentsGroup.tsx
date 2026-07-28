import {
  AGENT_DOCUMENT_CATEGORY,
  AGENT_DOCUMENT_WEB_CATEGORY,
  buildAgentSkillIdentifier,
} from '@lobechat/const';
import { ActionIcon, Center, Empty, Flexbox, Text } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { App } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { LucideIcon } from 'lucide-react';
import { EyeIcon, FileTextIcon, GlobeIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import type { CSSProperties, MouseEvent } from 'react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { buildAgentDocumentPath } from '@/features/AgentDocumentPage/navigation';
import { DocumentExplorerTree } from '@/features/AgentDocumentsExplorer';
import { startSkillDrag } from '@/features/ChatInput/InputEditor/ActionTag/skillDragData';
import {
  openRenameSkillModal,
  type SkillListItem,
  type SkillRowAction,
  SkillSection,
  SkillsList,
  useProjectSkills,
} from '@/features/SkillsList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useClientDataSWR } from '@/libs/swr';
import { agentDocumentService, agentDocumentSWRKeys } from '@/services/agentDocument';
import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { standardizeIdentifier } from '@/utils/identifier';

import DeviceLevelSkills from './DeviceLevelSkills';
import ProjectLevelSkills from './ProjectLevelSkills';
import UserLevelSkills, { useUserSkills } from './UserLevelSkills';

dayjs.extend(relativeTime);

export type ResourceFilter = 'skills' | 'documents' | 'web';
type DocumentOpenMode = 'portal' | 'route';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    cursor: pointer;
    padding: 12px;
    border-radius: 8px;
    background: ${cssVar.colorFillTertiary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  containerActive: css`
    background: ${cssVar.colorFillSecondary};
  `,
  description: css`
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
  `,
  meta: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  pillActive: css`
    font-weight: 500;
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  pillTab: css`
    cursor: pointer;
    user-select: none;

    padding-block: 4px;
    padding-inline: 12px;
    border-radius: 999px;

    font-size: 12px;
    line-height: 1.4;
    color: ${cssVar.colorTextSecondary};

    background: transparent;

    transition:
      background ${cssVar.motionDurationFast} ${cssVar.motionEaseInOut},
      color ${cssVar.motionDurationFast} ${cssVar.motionEaseInOut};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  title: css`
    font-weight: 500;
  `,
}));

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
    const { message } = App.useApp();
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
            });
            await mutate();
            if (isActive) onCurrentDeleted?.();
            message.success(t('workingPanel.resources.deleteSuccess', { ns: 'chat' }));
          } catch (error) {
            message.error(
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

    return (
      <Flexbox
        horizontal
        align={'flex-start'}
        className={`${styles.container} ${isActive ? styles.containerActive : ''}`}
        gap={8}
        onClick={handleOpen}
      >
        <IconComponent size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <Flexbox gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Flexbox horizontal align={'center'} distribution={'space-between'}>
            <Text ellipsis className={styles.title}>
              {title}
            </Text>
            {!hideDelete && (
              <ActionIcon
                icon={Trash2Icon}
                loading={deleting}
                size={'small'}
                title={t('delete', { ns: 'common' })}
                onClick={handleDelete}
              />
            )}
          </Flexbox>
          {description && (
            <Text className={styles.description} ellipsis={{ rows: 2 }}>
              {description}
            </Text>
          )}
          {updatedAtLabel && <Text className={styles.meta}>{updatedAtLabel}</Text>}
        </Flexbox>
      </Flexbox>
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
    deviceId,
    enabled = true,
    openMode,
    showFilterTabs = true,
    showLocalProjectSkills = false,
    style,
    workingDirectory,
  }) => {
    const { t } = useTranslation('chat');
    const { t: tCommon } = useTranslation('common');
    const { message } = App.useApp();
    const agentId = useAgentStore((s) => s.activeAgentId);
    const { docId } = useParams<{ docId?: string }>();
    const navigate = useWorkspaceAwareNavigate();
    const openDocument = useChatStore((s) => s.openDocument);
    const isDocumentMode = !!docId;
    const resolvedOpenMode = openMode ?? (isDocumentMode ? 'route' : 'portal');
    const isLocalEnabled = useAgentStore((s) =>
      agentId ? chatConfigByIdSelectors.isLocalSystemEnabledById(agentId)(s) : false,
    );
    const [filter, setFilter] = useState<ResourceFilter>(() =>
      isDocumentMode ? 'documents' : 'skills',
    );
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
    const showProjectSkills =
      (showLocalProjectSkills || isLocalEnabled || !!deviceId) && !!workingDirectory;

    // Mirror what each child component reads so the parent can decide the
    // section layout (flat when a single source has items, sectioned otherwise).
    // Both hooks are SWR-deduped against their respective child fetches.
    const userSkillItems = useUserSkills();
    const {
      deviceItems: deviceSkillItems,
      error: projectSkillsError,
      isLoading: isProjectSkillsLoading,
      projectItems: projectSkillItems,
    } = useProjectSkills(showProjectSkills ? workingDirectory : undefined, deviceId);

    const {
      data = [],
      error,
      isLoading,
      mutate,
    } = useClientDataSWR(
      enabled && agentId ? agentDocumentSWRKeys.documentsList(agentId) : null,
      () => agentDocumentService.listDocuments({ agentId: agentId! }),
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
          fileCount: files.length,
          files,
          id: bundle.documentId,
          name: bundle.title || bundle.filename || '',
        })),
      [skillBundleViews],
    );

    if (!agentId) return null;

    if (isLoading) {
      return (
        <Center flex={1} paddingBlock={24}>
          <NeuralNetworkLoading size={32} />
        </Center>
      );
    }

    if (error) {
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

    const openAgentDocument = (documentId: string, agentDocumentId?: string) => {
      if (!agentId) return;
      if (resolvedOpenMode === 'portal') {
        openDocument(
          documentId,
          agentDocumentId ?? data.find((doc) => doc.documentId === documentId)?.id,
        );
        return;
      }
      navigate(buildAgentDocumentPath(agentId, documentId));
    };

    const backToChat = () => {
      if (!agentId) return;
      navigate(`/agent/${agentId}`);
    };

    // Open the SKILL.md (skills/index child) when present; fall back to the
    // bundle itself (orphan bundles surface for recovery).
    const openAgentSkill = (item: SkillListItem) => {
      const view = skillBundleViews.find((v) => v.bundle.documentId === item.id);
      const indexChild = data.find((doc) => doc.parentId === item.id && doc.isSkillIndex);
      const targetDocId = indexChild?.documentId ?? view?.bundle.documentId ?? item.id;
      openAgentDocument(targetDocId);
    };

    // Agent skills are document bundles, so view / rename / delete map onto the
    // agent-document service (`item.id` is the bundle's documentId; the service
    // keys off the row id carried on the bundle).
    const getAgentSkillActions = (item: SkillListItem): SkillRowAction[] => {
      const view = skillBundleViews.find((v) => v.bundle.documentId === item.id);
      const rowId = view?.bundle.id;
      return [
        {
          icon: EyeIcon,
          key: 'view',
          label: t('workingPanel.skills.actions.view'),
          onClick: openAgentSkill,
        },
        {
          disabled: !rowId,
          icon: PencilIcon,
          key: 'rename',
          label: t('workingPanel.skills.actions.rename'),
          onClick: () => {
            if (!rowId) return;
            openRenameSkillModal({
              currentName: item.name,
              onSubmit: async (newName) => {
                try {
                  await agentDocumentService.renameDocument({
                    agentId: agentId!,
                    id: rowId,
                    newTitle: newName,
                  });
                  await mutate();
                  return undefined;
                } catch (error) {
                  return error instanceof Error
                    ? error.message
                    : t('workingPanel.skills.rename.error');
                }
              },
            });
          },
        },
        {
          danger: true,
          disabled: !rowId,
          icon: Trash2Icon,
          key: 'delete',
          label: t('workingPanel.skills.actions.delete'),
          onClick: () => {
            if (!rowId) return;
            confirmModal({
              cancelText: tCommon('cancel'),
              content: t('workingPanel.skills.delete.agentConfirm', { name: item.name }),
              okButtonProps: { danger: true },
              okText: tCommon('delete'),
              onOk: async () => {
                try {
                  await agentDocumentService.removeDocument({ agentId: agentId!, id: rowId });
                  await mutate();
                  message.success(t('workingPanel.skills.delete.success'));
                } catch (error) {
                  message.error(
                    error instanceof Error ? error.message : t('workingPanel.skills.delete.error'),
                  );
                }
              },
              title: t('workingPanel.skills.delete.title'),
            });
          },
        },
      ];
    };

    const renderAgentSkillsList = () => (
      <SkillsList
        getRowActions={getAgentSkillActions}
        items={skillItems}
        onOpenSkill={openAgentSkill}
        onOpenFile={(item, relativePath) => {
          const view = skillBundleViews.find((v) => v.bundle.documentId === item.id);
          const docId = view?.pathToDocumentId.get(relativePath);
          if (!docId) return;
          openAgentDocument(docId);
        }}
        onSkillDragStart={(item, event) => {
          // The runtime resolves these via the `agent-skills:<filename>`
          // identifier (built from the shared const helper so the prefix stays
          // in lockstep with the server-side resolver). Display label keeps
          // the human-readable title.
          const view = skillBundleViews.find((v) => v.bundle.documentId === item.id);
          const filename = view?.bundle.filename;
          if (!filename) return;
          startSkillDrag(event, {
            category: 'agentSkill',
            label: item.name,
            type: buildAgentSkillIdentifier(filename),
          });
        }}
      />
    );

    const renderSkills = () => {
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
          return (
            <Center flex={1} paddingBlock={24}>
              <AsyncError error={projectSkillsError} variant={'block'} />
            </Center>
          );
        }

        // Project skills refetch on a working-directory switch (new SWR key →
        // empty items while in flight). Show the loader instead of flashing the
        // empty placeholder when there's nothing else to render yet.
        if (showProjectSkills && isProjectSkillsLoading) {
          return (
            <Center flex={1} paddingBlock={24}>
              <NeuralNetworkLoading size={32} />
            </Center>
          );
        }
        return (
          <Center flex={1} gap={8} paddingBlock={24}>
            <Empty description={t('workingPanel.skills.empty')} icon={SkillsIcon} />
          </Center>
        );
      }

      const flat = activeCount === 1;

      return (
        <Flexbox gap={16} style={{ paddingBottom: 16 }}>
          {hasAgent &&
            (flat ? (
              renderAgentSkillsList()
            ) : (
              <SkillSection
                sectionHeader={{
                  count: skillItems.length,
                  title: t('workingPanel.skills.section.agent'),
                }}
              >
                {renderAgentSkillsList()}
              </SkillSection>
            ))}
          {hasProject && (
            <ProjectLevelSkills
              deviceId={deviceId}
              hideHeader={flat}
              workingDirectory={workingDirectory!}
            />
          )}
          {hasDevice && (
            <DeviceLevelSkills
              deviceId={deviceId}
              hideHeader={flat}
              workingDirectory={workingDirectory!}
            />
          )}
          {hasUser && <UserLevelSkills hideHeader={flat} />}
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
          mutate={mutate}
          style={{ height: '100%' }}
          onOpenDocument={openAgentDocument}
        />
      </Flexbox>
    );

    const renderWeb = () => {
      if (webData.length === 0) {
        return (
          <Center flex={1} gap={8} paddingBlock={24}>
            <Empty description={t('workingPanel.resources.empty')} icon={GlobeIcon} />
          </Center>
        );
      }
      return (
        <Flexbox gap={8}>
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
                  className={cx(styles.pillTab, active && styles.pillActive)}
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

export default AgentDocumentsGroup;
