import { ActionIcon, type DropdownItem, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowDownUpIcon, FilePlusIcon, FileUp, FolderPlusIcon, PlusIcon } from 'lucide-react';
import { memo, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { AgentDocumentSort } from '@/store/global/initialState';

const styles = stylex.create({
  toolbar: { paddingInlineStart: '10px', color: cssVar.colorTextSecondary },
  title: { fontSize: '11px', fontWeight: 500 },
});

const SORT_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;
const SORT_ORDERS = ['asc', 'desc'] as const;

interface Props {
  onCreateDocument: () => void;
  onCreateFolder: () => void;
  onSortChange: (sort: AgentDocumentSort) => void;
  onUploadFiles: (files: File[]) => void;
  sort: AgentDocumentSort;
}

const DocumentExplorerToolbar = memo<Props>(
  ({ onCreateDocument, onCreateFolder, onSortChange, onUploadFiles, sort }) => {
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
        className={stylex.props(styles.toolbar).className}
        distribution={'space-between'}
      >
        <Text className={stylex.props(styles.title).className} type={'secondary'}>
          {t('workingPanel.resources.filter.documents')}
        </Text>
        <Flexbox horizontal align={'center'}>
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
