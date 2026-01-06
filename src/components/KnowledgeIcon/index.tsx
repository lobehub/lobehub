import { Center } from '@lobehub/ui';
import { memo } from 'react';

import FileIcon from '@/components/FileIcon';
import RepoIcon from '@/components/LibIcon';
import { KnowledgeType } from '@/types/knowledgeBase';

interface KnowledgeIconProps {
  fileType?: string;
  name: string;
  size?: number | { file?: number; repo?: number };
  type: KnowledgeType;
}

const KnowledgeIcon = memo<KnowledgeIconProps>(({ type, size, fileType, name }) => {
  const repoSize = (typeof size === 'object' ? size.repo : size) || 24;
  const fileSize = (typeof size === 'object' ? size.file : size) || 24;

  return type === KnowledgeType.KnowledgeBase ? (
    <Center height={repoSize} width={repoSize}>
      <RepoIcon size={repoSize / 1.2} />
    </Center>
  ) : (
    <FileIcon fileName={name} fileType={fileType!} size={fileSize} />
  );
});

export default KnowledgeIcon;
