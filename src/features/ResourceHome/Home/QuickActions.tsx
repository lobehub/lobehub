'use client';

import { CUSTOM_DOCUMENT_FILE_TYPE, DERIVED_DOCUMENT_SOURCE_TYPE } from '@lobechat/const';
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { FilePenLine, FileUp, FolderUp, LibraryBigIcon, type LucideIcon } from 'lucide-react';
import { type ChangeEvent, memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateNewModal } from '@/features/LibraryModal';
import useUploadFolder from '@/features/ResourceManager/components/Header/hooks/useUploadFolder';
import { useTopLevelFileUpload } from '@/features/ResourceManager/hooks/useTopLevelFileUpload';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useFileStore } from '@/store/file';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    cursor: pointer;

    display: flex;
    gap: 12px;
    align-items: center;

    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    text-align: start;

    background: ${cssVar.colorFillQuaternary};

    transition: all 0.2s ${cssVar.motionEaseInOut};

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillTertiary};
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
  `,
  iconWrap: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};
  `,
  title: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));

interface ActionCardProps {
  disabled?: boolean;
  icon: LucideIcon;
  onClick: () => void;
  title: string;
}

const ActionCard = memo<ActionCardProps>(({ icon, title, onClick, disabled }) => (
  <button className={styles.card} disabled={disabled} type={'button'} onClick={onClick}>
    <span className={styles.iconWrap}>
      <Icon icon={icon} size={18} />
    </span>
    <span className={styles.title}>{title}</span>
  </button>
));

ActionCard.displayName = 'ActionCard';

/**
 * The four ingestion entries of the library home: upload files / folder,
 * create a page, create a library.
 */
const QuickActions = memo(() => {
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();
  const { allowed: canCreate, reason } = usePermission('create_content');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const uploadTopLevel = useTopLevelFileUpload();
  const uploadFolderWithStructure = useFileStore((s) => s.uploadFolderWithStructure);
  const createResourceAndSync = useFileStore((s) => s.createResourceAndSync);
  const [setCurrentViewItemId, setMode] = useResourceManagerStore((s) => [
    s.setCurrentViewItemId,
    s.setMode,
  ]);

  const { open: openCreateLibrary } = useCreateNewModal();

  const { handleFolderUpload } = useUploadFolder({
    currentFolderId: undefined,
    libraryId: undefined,
    t,
    uploadFolderWithStructure,
  });

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (selected.length > 0) await uploadTopLevel(selected);
    },
    [uploadTopLevel],
  );

  const handleNewPage = useCallback(async () => {
    const realId = await createResourceAndSync({
      content: '',
      fileType: CUSTOM_DOCUMENT_FILE_TYPE,
      sourceType: DERIVED_DOCUMENT_SOURCE_TYPE,
      title: t('pageList.untitled'),
    });

    setCurrentViewItemId(realId);
    setMode('page');
  }, [createResourceAndSync, setCurrentViewItemId, setMode, t]);

  const handleNewLibrary = useCallback(() => {
    openCreateLibrary({
      onSuccess: (id) => {
        navigate(`/resource/library/${id}`);
      },
    });
  }, [openCreateLibrary, navigate]);

  const actions: ActionCardProps[] = [
    {
      icon: FileUp,
      onClick: () => fileInputRef.current?.click(),
      title: t('home.uploadEntries.files.title'),
    },
    {
      icon: FolderUp,
      onClick: () => folderInputRef.current?.click(),
      title: t('home.uploadEntries.folder.title'),
    },
    {
      icon: FilePenLine,
      onClick: handleNewPage,
      title: t('home.uploadEntries.newPage.title'),
    },
    {
      icon: LibraryBigIcon,
      onClick: handleNewLibrary,
      title: t('home.uploadEntries.library.title'),
    },
  ];

  return (
    <Flexbox gap={12}>
      <div className={styles.grid}>
        {actions.map((action) => (
          <Tooltip key={action.title} title={canCreate ? undefined : reason}>
            <ActionCard {...action} disabled={!canCreate} />
          </Tooltip>
        ))}
      </div>
      <input
        multiple
        ref={fileInputRef}
        style={{ display: 'none' }}
        type={'file'}
        onChange={handleFileChange}
      />
      <input
        multiple
        ref={folderInputRef}
        style={{ display: 'none' }}
        type={'file'}
        // @ts-expect-error - webkitdirectory is not in the React types
        webkitdirectory=""
        onChange={handleFolderUpload}
      />
    </Flexbox>
  );
});

QuickActions.displayName = 'QuickActions';

export default QuickActions;
