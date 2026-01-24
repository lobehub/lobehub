'use client';

import { Flexbox, Icon, Markdown } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { FolderArchive } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { dataSelectors, useConversationStore } from '../../store';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    border-radius: 12px;
    padding: 8px 12px;
    background: ${cssVar.colorBgContainer};
    border: 1px solid ${cssVar.colorBorderSecondary};
  `,
  content: css`
  `,
  divider: css`
    margin: 0;
    padding-block: 16px;
  `,
  line: css`
    width: 3px;
    height: 100%;
    background: ${cssVar.colorText};
  `,
  tag: css`
    gap: 4px;
    align-items: center;

    padding-block: 4px;

    border-radius: 4px;
  `,
}));

export interface CompressedGroupMessageProps {
  id: string;
  index: number;
}

const CompressedGroupMessage = memo<CompressedGroupMessageProps>(({ id }) => {
  const { t } = useTranslation('chat');

  const message = useConversationStore(dataSelectors.getDisplayMessageById(id));
  const content = message?.content;

  return (
    <Flexbox className={styles.container}>
      <Flexbox className={styles.tag} horizontal>
        <Icon icon={FolderArchive} size={14} />
        {t('compressedHistory')}
      </Flexbox>
      {!!content && (
        <Flexbox gap={8}>
          <Flexbox align={'flex-start'} gap={8} horizontal>
            <Markdown className={styles.content} variant={'chat'}>
              {content}
            </Markdown>
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
});

CompressedGroupMessage.displayName = 'CompressedGroupMessage';

export default CompressedGroupMessage;
