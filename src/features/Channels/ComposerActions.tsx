import { ActionIcon, type DropdownItem, DropdownMenu, Icon } from '@lobehub/ui';
import { AtSign, CirclePlus, Paperclip } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ComposerActionsProps {
  disabled?: boolean;
  /** Omitted when nobody can be mentioned here. */
  onMention?: () => void;
  /** Omitted when uploads are off for this server. */
  upload?: {
    /** The user lacks permission to upload here. */
    blocked?: boolean;
    onFiles: (files: File[]) => void;
  };
}

/** The composer's "+" menu: everything you can add to a message besides typing. */
export function ComposerActions({ disabled, onMention, upload }: ComposerActionsProps) {
  const { t } = useTranslation('channel');
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null);

  const items: DropdownItem[] = [];
  if (upload)
    items.push({
      disabled: upload.blocked,
      icon: <Icon icon={Paperclip} />,
      key: 'upload',
      label: t('attachments.upload'),
      onClick: () => fileInput?.click(),
    });
  if (onMention)
    items.push({
      icon: <Icon icon={AtSign} />,
      key: 'mention',
      label: t('composer.mention'),
      onClick: onMention,
    });
  if (items.length === 0) return null;

  return (
    <>
      <DropdownMenu items={items} placement="topLeft">
        <ActionIcon
          aria-label={t('composer.actions')}
          disabled={disabled}
          icon={CirclePlus}
          size={{ blockSize: 28, size: 20 }}
          title={t('composer.actions')}
        />
      </DropdownMenu>
      {upload && (
        <input
          hidden
          multiple
          ref={setFileInput}
          type="file"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            // Let the same file be picked again after it is removed from the draft.
            event.target.value = '';
            if (files.length > 0) upload.onFiles(files);
          }}
        />
      )}
    </>
  );
}
