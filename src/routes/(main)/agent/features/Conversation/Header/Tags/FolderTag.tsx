import { Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

const styles = createStaticStyles(({ css }) => ({
  chip: css`
    cursor: pointer;

    overflow: hidden;
    display: inline-flex;
    align-items: center;

    max-width: 200px;

    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;

    transition: color 0.2s;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
}));

const FolderTag = memo(() => {
  const { t } = useTranslation('tool');

  const topicBoundDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);

  if (!isDesktop || !topicBoundDirectory) return null;

  const displayName = topicBoundDirectory.split('/').findLast(Boolean) || topicBoundDirectory;

  const handleOpen = () => {
    void localFileService.openLocalFolder({ isDirectory: true, path: topicBoundDirectory });
  };

  return (
    <Tooltip title={`${topicBoundDirectory} · ${t('localFiles.openFolder')}`}>
      <span className={styles.chip} onClick={handleOpen}>
        {displayName}
      </span>
    </Tooltip>
  );
});

FolderTag.displayName = 'TopicFolderTag';

export default FolderTag;
