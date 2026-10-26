'use client';

import { Icon, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FilePlus2Icon, LibraryBigIcon, type LucideIcon, UploadIcon } from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateNewModal } from '@/features/LibraryModal';
import { useTopLevelFileUpload } from '@/features/ResourceManager/hooks/useTopLevelFileUpload';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { pageActions } from '@/store/page';

import { docsPagePath } from '../paths';

const styles = stylex.create({
  action: {
    cursor: { 'default': 'pointer', ':disabled': 'not-allowed' },
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    paddingBlock: '14px',
    paddingInline: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { 'default': cssVar.colorBorderSecondary, ':hover': cssVar.colorBorder },
    borderRadius: cssVar.borderRadiusLG,
    textAlign: 'start',
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorFillQuaternary },
    opacity: { 'default': 1, ':disabled': 0.5 },
    transitionProperty: 'border-color, background-color',
    transitionDuration: '0.2s',
    transitionTimingFunction: cssVar.motionEaseInOut,
  },
  desc: {
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '12px',
  },
  icon: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '36px',
    height: '36px',
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorPrimary,
    backgroundColor: cssVar.colorPrimaryBg,
  },
  title: {
    fontSize: '14px',
    fontWeight: 500,
    color: cssVar.colorText,
  },
});

interface ActionProps {
  desc: string;
  disabled?: boolean;
  icon: LucideIcon;
  loading?: boolean;
  onClick: () => void;
  title: string;
}

const Action = memo<ActionProps>(({ desc, disabled, icon, loading, onClick, title }) => (
  <button
    disabled={disabled || loading}
    type={'button'}
    {...stylex.props(styles.action)}
    onClick={onClick}
  >
    <span {...stylex.props(styles.icon)}>
      <Icon icon={icon} size={18} spin={loading && icon === UploadIcon} />
    </span>
    <span>
      <div {...stylex.props(styles.title)}>{title}</div>
      <div {...stylex.props(styles.desc)}>{desc}</div>
    </span>
  </button>
));

Action.displayName = 'QuickAction';

interface QuickActionsProps {
  /** Called once a page or file lands, so the list below can refresh. */
  onCreated?: () => void;
}

/** The three ways to add something to Docs: write, upload, organize. */
const QuickActions = memo<QuickActionsProps>(({ onCreated }) => {
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();
  const { allowed: canCreate, reason } = usePermission('create_content');
  const upload = useTopLevelFileUpload();
  const { open: openCreateLibrary } = useCreateNewModal();
  const inputRef = useRef<HTMLInputElement>(null);
  const [creatingPage, setCreatingPage] = useState(false);

  const createPage = async () => {
    setCreatingPage(true);
    try {
      const page = await pageActions.createPage({ title: t('pageList.untitled') });
      navigate(docsPagePath(page.id));
      void pageActions.refreshDocuments();
      onCreated?.();
    } catch (error) {
      console.error('[QuickActions] failed to create a page:', error);
      toast.error(t('operationFailed', { ns: 'common' }));
    } finally {
      setCreatingPage(false);
    }
  };

  return (
    <div {...stylex.props(styles.grid)} title={canCreate ? undefined : reason}>
      <Action
        desc={t('docs.home.quick.newPage.desc')}
        disabled={!canCreate}
        icon={FilePlus2Icon}
        loading={creatingPage}
        title={t('docs.home.quick.newPage.title')}
        onClick={createPage}
      />
      <Action
        desc={t('docs.home.quick.upload.desc')}
        disabled={!canCreate}
        icon={UploadIcon}
        title={t('docs.home.quick.upload.title')}
        onClick={() => inputRef.current?.click()}
      />
      <Action
        desc={t('docs.home.quick.newKnowledgeBase.desc')}
        disabled={!canCreate}
        icon={LibraryBigIcon}
        title={t('docs.home.quick.newKnowledgeBase.title')}
        onClick={() =>
          openCreateLibrary({ onSuccess: (id) => navigate(`/resource/library/${id}`) })
        }
      />
      <input
        multiple
        ref={inputRef}
        style={{ display: 'none' }}
        type={'file'}
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length === 0) return;
          await upload(files);
          onCreated?.();
        }}
      />
    </div>
  );
});

QuickActions.displayName = 'QuickActions';

export default QuickActions;
