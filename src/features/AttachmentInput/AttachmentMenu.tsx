'use client';

import { Icon } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { Upload } from 'antd';
import { css, cx } from 'antd-style';
import { ChevronRight, FileUp, LibraryBig, PlusIcon, TypeIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExistingEditorAttachment } from '@/features/EditorCanvas/editorAttachments';
import { openLibraryFilePicker } from '@/features/LibraryModal';

import ActionDropdown, {
  type ActionDropdownMenuItems,
} from '../ChatInput/ActionBar/components/ActionDropdown';

const hotArea = css`
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: transparent;
  }
`;

interface AttachmentMenuProps {
  disabled?: boolean;
  formatEnabled: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
  onFormatEnabledChange: (enabled: boolean) => void;
  onLibraryFiles: (attachments: ExistingEditorAttachment[]) => void;
}

const AttachmentMenu = memo<AttachmentMenuProps>(
  ({ disabled, formatEnabled, onFiles, onFormatEnabledChange, onLibraryFiles }) => {
    const { t } = useTranslation(['chat', 'editor', 'file']);
    const [open, setOpen] = useState(false);

    const items = useMemo<ActionDropdownMenuItems>(
      () => [
        {
          children: [
            {
              closeOnClick: false,
              icon: <Icon icon={FileUp} size={18} />,
              key: 'upload',
              label: (
                <Upload
                  multiple
                  showUploadList={false}
                  beforeUpload={(file, fileList) => {
                    if (file === fileList.at(-1)) {
                      setOpen(false);
                      void onFiles(fileList);
                    }
                    return false;
                  }}
                >
                  <div className={cx(hotArea)}>
                    {t('upload.action.fileOrImageUpload', { ns: 'chat' })}
                  </div>
                </Upload>
              ),
            },
            {
              icon: <Icon icon={LibraryBig} size={18} />,
              key: 'library',
              label: t('pageEditor.comments.attachments.chooseLibrary', { ns: 'file' }),
              onClick: () => {
                setOpen(false);
                openLibraryFilePicker(onLibraryFiles);
              },
            },
          ],
          extra: <Icon className={'lobe-submenu-chevron'} icon={ChevronRight} size={16} />,
          icon: LibraryBig,
          key: 'attachments',
          label: t('plus.addAttachments', { ns: 'chat' }),
        },
        { type: 'divider' },
        {
          checked: formatEnabled,
          icon: TypeIcon,
          key: 'formatting',
          label: t('actions.typobar.title', { ns: 'editor' }),
          onCheckedChange: onFormatEnabledChange,
          type: 'switch',
        },
      ],
      [formatEnabled, onFiles, onFormatEnabledChange, onLibraryFiles, t],
    );

    const title = t('pageEditor.comments.attachments.add', { ns: 'file' });

    return (
      <ActionDropdown menu={{ items }} open={open} placement={'topLeft'} onOpenChange={setOpen}>
        <ActionIcon
          aria-label={title}
          disabled={disabled}
          icon={PlusIcon}
          size={{ blockSize: 32, size: 18 }}
          title={title}
          onClick={() => setOpen(true)}
        />
      </ActionDropdown>
    );
  },
);

AttachmentMenu.displayName = 'AttachmentMenu';

export default AttachmentMenu;
