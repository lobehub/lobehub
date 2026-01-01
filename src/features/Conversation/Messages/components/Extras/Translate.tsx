import { type ChatTranslate } from '@lobechat/types';
import { ActionIcon, Flexbox, Icon, Markdown, Tag, copyToClipboard } from '@lobehub/ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import { ChevronDown, ChevronUp, ChevronsRight, CopyIcon, TrashIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BubblesLoading from '@/components/BubblesLoading';

import { useConversationStore } from '../../../store';

interface TranslateProps extends ChatTranslate {
  id: string;
  loading?: boolean;
}

const Translate = memo<TranslateProps>(({ content = '', from, to, id, loading }) => {
  const { t } = useTranslation('common');
  const [show, setShow] = useState(true);
  const clearTranslate = useConversationStore((s) => s.clearTranslate);

  const { message } = App.useApp();
  return (
    <Flexbox gap={8}>
      <Flexbox align={'center'} horizontal justify={'space-between'}>
        <div>
          <Flexbox gap={4} horizontal>
            <Tag style={{ margin: 0 }}>{from ? t(`lang.${from}` as any) : '...'}</Tag>
            <Icon color={cssVar.colorTextTertiary} icon={ChevronsRight} />
            <Tag>{t(`lang.${to}` as any)}</Tag>
          </Flexbox>
        </div>
        <Flexbox horizontal>
          <ActionIcon
            icon={CopyIcon}
            onClick={async () => {
              await copyToClipboard(content);
              message.success(t('copySuccess'));
            }}
            size={'small'}
            title={t('copy')}
          />
          <ActionIcon
            icon={TrashIcon}
            onClick={() => {
              clearTranslate(id);
            }}
            size={'small'}
            title={t('translate.clear', { ns: 'chat' })}
          />
          <ActionIcon
            icon={show ? ChevronDown : ChevronUp}
            onClick={() => {
              setShow(!show);
            }}
            size={'small'}
          />
        </Flexbox>
      </Flexbox>
      {!show ? null : loading && !content ? (
        <BubblesLoading />
      ) : (
        <Markdown variant={'chat'}>{content}</Markdown>
      )}
    </Flexbox>
  );
});

export default Translate;
