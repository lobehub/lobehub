import { UIChatMessage } from '@lobechat/types';
import { Button, copyToClipboard } from '@lobehub/ui';
import { App } from 'antd';
import isEqual from 'fast-deep-equal';
import { CopyIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { exportFile } from '@/utils/client';

import { useStyles } from '../style';
import Preview from './Preview';
import { generateMarkdown } from './template';

interface ShareTextProps {
  item: UIChatMessage;
}

const ShareText = memo<ShareTextProps>(({ item }) => {
  const { t } = useTranslation(['chat', 'common']);
  const { styles } = useStyles();
  const { message } = App.useApp();

  const messages = [item];
  const topic = useChatStore(topicSelectors.currentActiveTopic, isEqual);

  const title = topic?.title || t('shareModal.exportTitle');
  const content = generateMarkdown({
    messages,
  }).replaceAll('\n\n\n', '\n');

  const isMobile = useIsMobile();

  const button = (
    <>
      <Button
        block
        icon={CopyIcon}
        onClick={async () => {
          await copyToClipboard(content);
          message.success(t('copySuccess', { defaultValue: 'Copy Success', ns: 'common' }));
        }}
        size={isMobile ? undefined : 'large'}
        type={'primary'}
      >
        {t('copy', { ns: 'common' })}
      </Button>
      <Button
        block
        onClick={() => {
          exportFile(content, `${title}.md`);
        }}
        size={isMobile ? undefined : 'large'}
      >
        {t('shareModal.downloadFile')}
      </Button>
    </>
  );

  return (
    <>
      <Flexbox className={styles.body} gap={16} horizontal={!isMobile}>
        <Preview content={content} />
        <Flexbox className={styles.sidebar} gap={12}>
          {!isMobile && button}
        </Flexbox>
      </Flexbox>
      {isMobile && (
        <Flexbox className={styles.footer} gap={8} horizontal>
          {button}
        </Flexbox>
      )}
    </>
  );
});

export default ShareText;
