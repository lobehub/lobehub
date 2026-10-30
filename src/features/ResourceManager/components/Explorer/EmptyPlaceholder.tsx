import { Button, Center, FileTypeIcon, Flexbox, Icon, Text, Upload } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpIcon, PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useCreateNewModal } from '@/features/LibraryModal';
import { useCurrentFolderId } from '@/features/ResourceManager/hooks/useCurrentFolderId';
import { useTopLevelFileUpload } from '@/features/ResourceManager/hooks/useTopLevelFileUpload';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { getResourceSourceFilter } from '@/features/ResourceManager/store/selectors';
import { usePermission } from '@/hooks/usePermission';
import { useFileStore } from '@/store/file';
import { ResourceSourceFilter } from '@/types/files';

const ICON_SIZE = 80;

const styles = stylex.create({
  actionTitle: { marginBlockStart: '12px', fontSize: '16px', color: cssVar.colorTextSecondary },
  card: {
    cursor: 'pointer',
    position: 'relative',
    overflow: 'hidden',
    width: '200px',
    height: '140px',
    borderRadius: cssVar.borderRadiusLG,
    fontWeight: 500,
    textAlign: 'center',
    backgroundColor: { 'default': cssVar.colorFillTertiary, ':hover': cssVar.colorFillSecondary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    boxShadow: `0 0 0 1px ${cssVar.colorFillTertiary} inset`,
    transition: 'background 0.3s ease-in-out',
  },
  glow: {
    position: 'absolute',
    insetBlockEnd: '-12px',
    insetInlineEnd: '0',
    width: '48px',
    height: '48px',
    opacity: 0.5,
    filter: 'blur(24px)',
  },
  icon: {
    position: 'absolute',
    zIndex: 1,
    insetBlockEnd: '-24px',
    insetInlineEnd: '8px',
    flex: 'none',
  },
});

const EmptyPlaceholder = () => {
  const { t } = useTranslation('components');

  const pushDockFileList = useFileStore((s) => s.pushDockFileList);
  const uploadTopLevel = useTopLevelFileUpload();

  const libraryId = useResourceManagerStore((s) => s.libraryId);
  const [sourceFilter, setSourceFilter] = useResourceManagerStore((s) => [
    getResourceSourceFilter(s),
    s.setSourceFilter,
  ]);
  const currentFolderId = useCurrentFolderId();

  const { open } = useCreateNewModal();
  const { allowed: canCreate } = usePermission('create_content');

  // A narrowed source can empty a category that is not actually empty — the
  // images view opens on generated output, so a library of uploads would
  // otherwise read as "you have nothing yet". Name the filter and offer the
  // way back instead of the onboarding prompt.
  if (sourceFilter !== ResourceSourceFilter.All) {
    return (
      <Center gap={12} height={'100%'} style={{ paddingBottom: 100 }} width={'100%'}>
        <Text as={'h4'}>{t('FileManager.emptyStatus.filteredTitle')}</Text>
        <Button size={'small'} onClick={() => setSourceFilter(ResourceSourceFilter.All)}>
          {t('FileManager.emptyStatus.actions.showAllSources')}
        </Button>
      </Center>
    );
  }

  if (!canCreate) {
    return (
      <Center height={'100%'} style={{ paddingBottom: 100 }} width={'100%'}>
        <Text as={'h4'}>{t('FileManager.emptyStatus.title')}</Text>
      </Center>
    );
  }

  return (
    <Center gap={24} height={'100%'} style={{ paddingBottom: 100 }} width={'100%'}>
      <Flexbox justify={'center'} style={{ textAlign: 'center' }}>
        <Text as={'h4'}>{t('FileManager.emptyStatus.title')}</Text>
        <Text type={'secondary'}>{t('FileManager.emptyStatus.or')}</Text>
      </Flexbox>
      {/* Wraps so the three 200px cards stack on a phone instead of clipping. */}
      <Flexbox horizontal gap={12} justify={'center'} paddingInline={16} wrap={'wrap'}>
        {!libraryId && (
          <Flexbox
            className={stylex.props(styles.card).className}
            padding={16}
            onClick={() => {
              open();
            }}
          >
            <span {...stylex.props(styles.actionTitle)}>
              {t('FileManager.emptyStatus.actions.knowledgeBase')}
            </span>
            <div
              className={stylex.props(styles.glow).className}
              style={{ background: cssVar.purple }}
            />
            <FileTypeIcon
              className={stylex.props(styles.icon).className}
              color={cssVar.purple}
              icon={<Icon color={'#fff'} icon={PlusIcon} />}
              size={ICON_SIZE}
              type={'folder'}
            />
          </Flexbox>
        )}
        <Upload multiple={true} onFiles={(files) => void uploadTopLevel(files)}>
          <Flexbox className={stylex.props(styles.card).className} padding={16}>
            <span {...stylex.props(styles.actionTitle)}>
              {t('FileManager.emptyStatus.actions.file')}
            </span>
            <div
              className={stylex.props(styles.glow).className}
              style={{ background: cssVar.gold }}
            />
            <FileTypeIcon
              className={stylex.props(styles.icon).className}
              color={cssVar.gold}
              icon={<Icon color={'#fff'} icon={ArrowUpIcon} />}
              size={ICON_SIZE}
            />
          </Flexbox>
        </Upload>
        <Upload
          directory
          multiple={true}
          onFiles={(files) => {
            // Directory upload keeps its own path — the whole tree inherits
            // its root's visibility, so we skip the mode-driven default and
            // let the server infer from the parent chain.
            void pushDockFileList(files, libraryId, currentFolderId ?? undefined);
          }}
        >
          <Flexbox className={stylex.props(styles.card).className} padding={16}>
            <span {...stylex.props(styles.actionTitle)}>
              {t('FileManager.emptyStatus.actions.folder')}
            </span>
            <div
              className={stylex.props(styles.glow).className}
              style={{ background: cssVar.geekblue }}
            />
            <FileTypeIcon
              className={stylex.props(styles.icon).className}
              color={cssVar.geekblue}
              icon={<Icon color={'#fff'} icon={ArrowUpIcon} />}
              size={ICON_SIZE}
              type={'folder'}
            />
          </Flexbox>
        </Upload>
      </Flexbox>
    </Center>
  );
};

export default EmptyPlaceholder;
