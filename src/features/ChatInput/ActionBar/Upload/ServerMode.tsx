import { validateVideoFileSize } from '@lobechat/utils/client';
import { Icon, type ItemType, type MenuProps, Tooltip } from '@lobehub/ui';
import { Upload } from 'antd';
import { css, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ArrowRight, FileUp, FolderUp, ImageUp, LibraryBig, Paperclip } from 'lucide-react';
import { Suspense, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import FileIcon from '@/components/FileIcon';
import RepoIcon from '@/components/LibIcon';
import TipGuide from '@/components/TipGuide';
import { AttachKnowledgeModal } from '@/features/LibraryModal';
import { useModelSupportVision } from '@/hooks/useModelSupportVision';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useFileStore } from '@/store/file';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import Action from '../components/Action';
import CheckboxItem from '../components/CheckbokWithLoading';

const hotArea = css`
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background-color: transparent;
  }
`;

const FileUpload = memo(() => {
  const { t } = useTranslation('chat');

  const upload = useFileStore((s) => s.uploadChatFiles);

  const agentId = useAgentId();
  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(agentId)(s));
  const provider = useAgentStore((s) => agentByIdSelectors.getAgentModelProviderById(agentId)(s));

  const canUploadImage = useModelSupportVision(model, provider);

  const [showTip, updateGuideState] = useUserStore((s) => [
    preferenceSelectors.showUploadFileInKnowledgeBaseTip(s),
    s.updateGuideState,
  ]);
  const [modalOpen, setModalOpen] = useState(false);
  const [updating, setUpdating] = useState(false);

  const files = useAgentStore((s) => agentByIdSelectors.getAgentFilesById(agentId)(s), isEqual);
  const knowledgeBases = useAgentStore(
    (s) => agentByIdSelectors.getAgentKnowledgeBasesById(agentId)(s),
    isEqual,
  );

  const [toggleFile, toggleKnowledgeBase] = useAgentStore((s) => [
    s.toggleFile,
    s.toggleKnowledgeBase,
  ]);

  const uploadItems: MenuProps['items'] = [
    {
      disabled: !canUploadImage,
      icon: ImageUp,
      key: 'upload-image',
      label: canUploadImage ? (
        <Upload
          accept={'image/*'}
          beforeUpload={async (file) => {
            await upload([file]);

            return false;
          }}
          multiple
          showUploadList={false}
        >
          <div className={cx(hotArea)}>{t('upload.action.imageUpload')}</div>
        </Upload>
      ) : (
        <Tooltip placement={'right'} title={t('upload.action.imageDisabled')}>
          <div className={cx(hotArea)}>{t('upload.action.imageUpload')}</div>
        </Tooltip>
      ),
    },
    {
      icon: FileUp,
      key: 'upload-file',
      label: (
        <Upload
          beforeUpload={async (file) => {
            if (!canUploadImage && (file.type.startsWith('image') || file.type.startsWith('video')))
              return false;

            // Validate video file size
            const validation = validateVideoFileSize(file);
            if (!validation.isValid) {
              message.error(
                t('upload.validation.videoSizeExceeded', {
                  actualSize: validation.actualSize,
                }),
              );
              return false;
            }

            await upload([file]);

            return false;
          }}
          multiple
          showUploadList={false}
        >
          <div className={cx(hotArea)}>{t('upload.action.fileUpload')}</div>
        </Upload>
      ),
    },
    {
      icon: FolderUp,
      key: 'upload-folder',
      label: (
        <Upload
          beforeUpload={async (file) => {
            if (!canUploadImage && (file.type.startsWith('image') || file.type.startsWith('video')))
              return false;

            // Validate video file size
            const validation = validateVideoFileSize(file);
            if (!validation.isValid) {
              message.error(
                t('upload.validation.videoSizeExceeded', {
                  actualSize: validation.actualSize,
                }),
              );
              return false;
            }

            await upload([file]);

            return false;
          }}
          directory
          multiple={true}
          showUploadList={false}
        >
          <div className={cx(hotArea)}>{t('upload.action.folderUpload')}</div>
        </Upload>
      ),
    },
  ];

  const knowledgeItems: ItemType[] = [];

  // Only add knowledge base items if there are files or knowledge bases
  if (files.length > 0 || knowledgeBases.length > 0) {
    knowledgeItems.push({
      children: [
        // first the files
        ...files.map((item) => ({
          icon: <FileIcon fileName={item.name} fileType={item.type} size={20} />,
          key: item.id,
          label: (
            <CheckboxItem
              checked={item.enabled}
              id={item.id}
              label={item.name}
              onUpdate={async (id, enabled) => {
                setUpdating(true);
                await toggleFile(id, enabled);
                setUpdating(false);
              }}
            />
          ),
        })),

        // then the knowledge bases
        ...knowledgeBases.map((item) => ({
          icon: <RepoIcon />,
          key: item.id,
          label: (
            <CheckboxItem
              checked={item.enabled}
              id={item.id}
              label={item.name}
              onUpdate={async (id, enabled) => {
                setUpdating(true);
                await toggleKnowledgeBase(id, enabled);
                setUpdating(false);
              }}
            />
          ),
        })),
      ],
      key: 'relativeFilesOrLibraries',
      label: t('knowledgeBase.relativeFilesOrLibraries'),
      type: 'group',
    });
  }

  // Always add the "View More" option
  knowledgeItems.push(
    {
      type: 'divider',
    },
    {
      extra: <Icon icon={ArrowRight} />,
      icon: LibraryBig,
      key: 'knowledge-base-store',
      label: t('knowledgeBase.viewMore'),
      onClick: () => {
        setModalOpen(true);
      },
    },
  );

  const items: MenuProps['items'] = [
    ...uploadItems,
    ...(knowledgeItems.length > 0 ? knowledgeItems : []),
  ];

  const content = (
    <Action
      dropdown={{
        maxHeight: 500,
        maxWidth: 480,
        menu: { items },
        minWidth: 240,
      }}
      icon={Paperclip}
      loading={updating}
      showTooltip={false}
      title={t('upload.action.tooltip')}
    />
  );

  return (
    <Suspense fallback={<Action disabled icon={Paperclip} title={t('upload.action.tooltip')} />}>
      {showTip ? (
        <TipGuide
          onOpenChange={() => {
            updateGuideState({ uploadFileInKnowledgeBase: false });
          }}
          open={showTip}
          placement={'top'}
          title={t('knowledgeBase.uploadGuide')}
        >
          {content}
        </TipGuide>
      ) : (
        content
      )}
      <AttachKnowledgeModal open={modalOpen} setOpen={setModalOpen} />
    </Suspense>
  );
});

export default FileUpload;
