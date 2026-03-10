import { validateVideoFileSize } from '@lobechat/utils/client';
import { type ItemType } from '@lobehub/ui';
import { Icon, Tooltip } from '@lobehub/ui';
import { Upload } from 'antd';
import { css, cx } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ArrowRight, FileUp, FolderUp, ImageUp, LibraryBig, Paperclip } from 'lucide-react';
import { memo, Suspense, useState } from 'react';
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
import { type ActionDropdownMenuItems } from '../components/ActionDropdown';
import CheckboxItem from '../components/CheckboxWithLoading';

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
  const [dropdownOpen, setDropdownOpen] = useState(false);
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

  const uploadItems: ActionDropdownMenuItems = [
    {
      closeOnClick: false,
      disabled: !canUploadImage,
      icon: ImageUp,
      key: 'upload-image',
      label: canUploadImage ? (
        <Upload
          multiple
          accept={'image/*'}
          showUploadList={false}
          beforeUpload={async (file) => {
            setDropdownOpen(false);
            await upload([file]);

            return false;
          }}
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
      closeOnClick: false,
      icon: FileUp,
      key: 'upload-file',
      label: (
        <Upload
          multiple
          showUploadList={false}
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

            setDropdownOpen(false);
            await upload([file]);

            return false;
          }}
        >
          <div className={cx(hotArea)}>{t('upload.action.fileUpload')}</div>
        </Upload>
      ),
    },
    {
      closeOnClick: false,
      icon: FolderUp,
      key: 'upload-folder',
      label: (
        <Upload
          directory
          multiple={true}
          showUploadList={false}
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

            setDropdownOpen(false);
            await upload([file]);

            return false;
          }}
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

  const items: ActionDropdownMenuItems = [
    ...uploadItems,
    ...(knowledgeItems.length > 0 ? knowledgeItems : []),
  ];

  const content = (
    <Action
      icon={Paperclip}
      loading={updating}
      open={dropdownOpen}
      showTooltip={false}
      title={t('upload.action.tooltip')}
      trigger={'both'}
      dropdown={{
        maxHeight: 500,
        maxWidth: 480,
        menu: { items },
        minWidth: 240,
      }}
      onOpenChange={setDropdownOpen}
    />
  );

  return (
    <Suspense fallback={<Action disabled icon={Paperclip} title={t('upload.action.tooltip')} />}>
      {showTip ? (
        <TipGuide
          open={showTip}
          placement={'top'}
          title={t('knowledgeBase.uploadGuide')}
          onOpenChange={() => {
            updateGuideState({ uploadFileInKnowledgeBase: false });
          }}
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
