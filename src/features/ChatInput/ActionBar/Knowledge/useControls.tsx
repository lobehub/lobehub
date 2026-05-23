import { type ItemType } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ArrowRight, LibraryBig } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import RepoIcon from '@/components/LibIcon';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import CheckboxItem from '../components/CheckboxWithLoading';

const labelMaxWidth = 'min(400px, 56vw)';

const styles = createStaticStyles(({ css }) => ({
  viewMore: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    width: calc(100% + 8px);
    min-height: 32px;
    margin-block-end: -4px;
    margin-inline-start: -4px;
    border: 0;
    border-radius: 6px;

    font-size: 14px;
    color: ${cssVar.colorText};

    background: transparent;

    transition: background 150ms ${cssVar.motionEaseOut};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  viewMoreLabel: css`
    flex: 1;
    text-align: start;
  `,
}));

export interface KnowledgeControls {
  enabledCount: number;
  footer: ReactNode;
  items: ItemType[];
}

export const useControls = ({
  openAttachKnowledgeModal,
}: {
  openAttachKnowledgeModal: () => void;
}) => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();

  const files = useAgentStore((s) => agentByIdSelectors.getAgentFilesById(agentId)(s), isEqual);
  const knowledgeBases = useAgentStore(
    (s) => agentByIdSelectors.getAgentKnowledgeBasesById(agentId)(s),
    isEqual,
  );

  const [toggleFile, toggleKnowledgeBase] = useAgentStore((s) => [
    s.toggleFile,
    s.toggleKnowledgeBase,
  ]);
  const enabledCount =
    files.filter((item) => item.enabled).length +
    knowledgeBases.filter((item) => item.enabled).length;

  const libraryItems = knowledgeBases.map((item) => ({
    icon: <RepoIcon />,
    key: item.id,
    label: (
      <CheckboxItem
        checked={item.enabled}
        id={item.id}
        label={item.name}
        labelMaxWidth={labelMaxWidth}
        onUpdate={async (id, enabled) => {
          await toggleKnowledgeBase(id, enabled);
        }}
      />
    ),
  }));

  const fileItems = files.map((item) => ({
    icon: <FileIcon fileName={item.name} fileType={item.type} size={20} />,
    key: item.id,
    label: (
      <CheckboxItem
        checked={item.enabled}
        id={item.id}
        label={item.name}
        labelMaxWidth={labelMaxWidth}
        onUpdate={async (id, enabled) => {
          await toggleFile(id, enabled);
        }}
      />
    ),
  }));

  const relatedGroups: ItemType[] = [
    ...(libraryItems.length > 0
      ? [
          {
            children: libraryItems,
            key: 'relativeLibraries',
            label: t('knowledgeBase.libraries'),
            type: 'group' as const,
          },
        ]
      : []),
    ...(libraryItems.length > 0 && fileItems.length > 0 ? [{ type: 'divider' as const }] : []),
    ...(fileItems.length > 0
      ? [
          {
            children: fileItems,
            key: 'relativeFiles',
            label: t('knowledgeBase.files'),
            type: 'group' as const,
          },
        ]
      : []),
  ];

  const footer = (
    <button
      className={cx(styles.viewMore)}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        openAttachKnowledgeModal();
      }}
    >
      <Icon icon={LibraryBig} size={16} />
      <span className={cx(styles.viewMoreLabel)}>{t('knowledgeBase.viewMore')}</span>
      <Icon icon={ArrowRight} size={16} />
    </button>
  );

  return { enabledCount, footer, items: relatedGroups } satisfies KnowledgeControls;
};
