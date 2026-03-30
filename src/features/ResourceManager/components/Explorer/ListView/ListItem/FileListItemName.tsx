import { Center, Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { Input } from 'antd';
import { FileText, FolderIcon } from 'lucide-react';

import FileIcon from '@/components/FileIcon';

import { styles } from './styles';
import TruncatedFileName from './TruncatedFileName';

interface FileListItemNameProps {
  emoji?: string | null;
  fallbackName: string;
  fileType: string;
  inputRef: any;
  isFolder: boolean;
  isPage: boolean;
  isRenaming: boolean;
  name: string;
  onRenameCancel: () => void;
  onRenameConfirm: () => void;
  onRenamingValueChange: (value: string) => void;
  renamingValue: string;
}

const FileListItemName = ({
  emoji,
  fallbackName,
  fileType,
  inputRef,
  isFolder,
  isPage,
  isRenaming,
  name,
  onRenameCancel,
  onRenameConfirm,
  onRenamingValueChange,
  renamingValue,
}: FileListItemNameProps) => (
  <Flexbox horizontal align={'center'} className={styles.nameContainer}>
    <Flexbox
      align={'center'}
      justify={'center'}
      style={{ fontSize: 24, marginInline: 8, width: 24 }}
    >
      {isFolder ? (
        <Icon icon={FolderIcon} size={24} />
      ) : isPage ? (
        emoji ? (
          <span style={{ fontSize: 24 }}>{emoji}</span>
        ) : (
          <Center height={24} width={24}>
            <Icon icon={FileText} size={24} />
          </Center>
        )
      ) : (
        <FileIcon fileName={name} fileType={fileType} size={24} />
      )}
    </Flexbox>
    {isRenaming && isFolder ? (
      <Input
        ref={inputRef}
        size="small"
        style={{ flex: 1, maxWidth: 400 }}
        value={renamingValue}
        onBlur={onRenameConfirm}
        onChange={(e) => onRenamingValueChange(e.target.value)}
        onClick={stopPropagation}
        onPointerDown={stopPropagation}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onRenameConfirm();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onRenameCancel();
          }
        }}
      />
    ) : (
      <TruncatedFileName className={styles.name} name={name || fallbackName} />
    )}
  </Flexbox>
);

export default FileListItemName;
