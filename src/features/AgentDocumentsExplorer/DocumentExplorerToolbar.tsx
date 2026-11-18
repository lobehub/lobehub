import {
  ActionIcon,
  createStaticStyles,
  cx,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Icon,
  Text,
} from '@lobehub/ui';
import { ArrowDownUpIcon, FilePlusIcon, FileUp, FolderPlusIcon, PlusIcon } from 'lucide-react';
import { memo, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentDocumentSort } from '@/store/global/initialState';
import { sidebarRow } from '@/styles/density.stylex';

const styles = createStaticStyles(({ css, cssVar }) => ({
  toolbar: css`
    /* Title on the column of the panel tabs' icons; the + stays on the row edge. */
    padding-inline-start: 10px;
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    font-size: 11px;
    font-weight: 500;
  `,
  compactToolbar: css`
    flex-shrink: 0;
    gap: 4px;
    height: ${sidebarRow.toolbarHeight};
    padding-inline: ${sidebarRow.toolbarPaddingInlineStart} ${sidebarRow.toolbarPaddingInlineEnd};
  `,
  compactTitle: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: ${sidebarRow.labelFontSize};
    font-weight: ${sidebarRow.labelFontWeight};
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const SORT_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;
const SORT_ORDERS = ['asc', 'desc'] as const;

interface Props {
  compact?: boolean;
  onCreateDocument: () => void;
  onCreateFolder: () => void;
  onSortChange: (sort: AgentDocumentSort) => void;
  onUploadFiles: (files: File[]) => void;
  sort: AgentDocumentSort;
}

const DocumentExplorerToolbar = memo<Props>(
  ({ compact, onCreateDocument, onCreateFolder, onSortChange, onUploadFiles, sort }) => {
    const { t } = useTranslation('chat');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const createMenuItems = useMemo<DropdownItem[]>(
      () => [
        {
          icon: <Icon icon={FilePlusIcon} />,
          key: 'new-document',
          label: t('workingPanel.resources.tree.newDocument'),
          onClick: onCreateDocument,
        },
        {
          icon: <Icon icon={FolderPlusIcon} />,
          key: 'new-folder',
          label: t('workingPanel.resources.tree.newFolder'),
          onClick: onCreateFolder,
        },
        { type: 'divider' as const },
        {
          icon: <Icon icon={FileUp} />,
          key: 'upload-file',
          label: t('workingPanel.resources.tree.uploadFile'),
          onClick: () => fileInputRef.current?.click(),
        },
      ],
      [onCreateDocument, onCreateFolder, t],
    );

    const sortMenuItems = useMemo<DropdownItem[]>(
      () => [
        {
          children: SORT_FIELDS.map((by) => ({
            checked: sort.by === by,
            key: `sort-by-${by}`,
            label: t(`workingPanel.resources.tree.sort.${by}`),
            onCheckedChange: () => onSortChange({ ...sort, by }),
            type: 'checkbox' as const,
          })),
          key: 'sort-by',
          label: t('workingPanel.resources.tree.sort.by'),
          type: 'group' as const,
        },
        { type: 'divider' as const },
        {
          children: SORT_ORDERS.map((order) => ({
            checked: sort.order === order,
            key: `sort-order-${order}`,
            label: t(`workingPanel.resources.tree.sort.${order}`),
            onCheckedChange: () => onSortChange({ ...sort, order }),
            type: 'checkbox' as const,
          })),
          key: 'sort-order',
          label: t('workingPanel.resources.tree.sort.order'),
          type: 'group' as const,
        },
        { type: 'divider' as const },
        {
          checked: sort.foldersFirst,
          key: 'sort-folders-first',
          label: t('workingPanel.resources.tree.sort.foldersFirst'),
          onCheckedChange: (foldersFirst: boolean) => onSortChange({ ...sort, foldersFirst }),
          type: 'checkbox' as const,
        },
      ],
      [onSortChange, sort, t],
    );

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={cx(styles.toolbar, compact && styles.compactToolbar)}
        distribution={'space-between'}
      >
        {compact ? (
          <span className={styles.compactTitle}>
            {t('workingPanel.resources.filter.documents')}
          </span>
        ) : (
          <Text className={styles.title} type={'secondary'}>
            {t('workingPanel.resources.filter.documents')}
          </Text>
        )}
        <Flexbox horizontal align={'center'} gap={compact ? 4 : undefined}>
          <DropdownMenu items={sortMenuItems} placement={'bottomRight'}>
            <ActionIcon
              icon={ArrowDownUpIcon}
              size={'small'}
              title={t('workingPanel.resources.tree.sort.title')}
            />
          </DropdownMenu>
          <DropdownMenu items={createMenuItems} placement={'bottomRight'}>
            <ActionIcon
              icon={PlusIcon}
              size={'small'}
              title={t('workingPanel.resources.tree.create')}
            />
          </DropdownMenu>
        </Flexbox>
        <input
          hidden
          multiple
          ref={fileInputRef}
          type={'file'}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length === 0) return;
            onUploadFiles(files);
          }}
        />
      </Flexbox>
    );
  },
);

DocumentExplorerToolbar.displayName = 'DocumentExplorerToolbar';

export default DocumentExplorerToolbar;
