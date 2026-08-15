import { Center } from '@lobehub/ui';
import { memo } from 'react';

import FileIcon from '@/components/FileIcon';
import RepoIcon from '@/components/LibIcon';
import LockedLibIcon from '@/components/LibIcon/Locked';
import { KnowledgeType } from '@/types/knowledgeBase';

interface KnowledgeIconProps {
  fileType?: string;
  /** KB only: render the shared restricted-library visual (folder + corner lock). */
  locked?: boolean;
  name: string;
  size?: number | { file?: number; repo?: number };
  type: KnowledgeType;
}

const KnowledgeIcon = memo<KnowledgeIconProps>(({ type, size, fileType, locked, name }) => {
  const repoSize = (typeof size === 'object' ? size.repo : size) || 24;
  const fileSize = (typeof size === 'object' ? size.file : size) || 24;

  return type === KnowledgeType.KnowledgeBase ? (
    <Center height={repoSize} width={repoSize}>
      {locked ? <LockedLibIcon size={repoSize / 1.2} /> : <RepoIcon size={repoSize / 1.2} />}
    </Center>
  ) : (
    <FileIcon fileName={name} fileType={fileType!} size={fileSize} />
  );
});

export default KnowledgeIcon;
