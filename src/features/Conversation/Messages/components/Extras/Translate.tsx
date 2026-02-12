import { type ChatTranslate } from '@lobechat/types';
import { ActionIcon, copyToClipboard, Flexbox, Icon, Markdown, Tag } from '@lobehub/ui';
import { App } from 'antd';
import { cssVar } from 'antd-style';
import { ChevronDown, ChevronsRight, ChevronUp, CopyIcon, TrashIcon } from 'lucide-react';
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
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <div>
          <Flexbox horizontal gap={4}>
            <Tag style={{ margin: 0 }}>{from ? t(`lang.${from}` as any) : '...'}</Tag>
            <Icon color={cssVar.colorTextTertiary} icon={ChevronsRight} />
            <Tag>{t(`lang.${to}` as any)}</Tag>
          </Flexbox>
        </div>
        <Flexbox horizontal>
          <ActionIcon
            icon={CopyIcon}
            size={'small'}
            title={t('copy')}
            onClick={async () => {
              await copyToClipboard(content);
              message.success(t('copySuccess'));
            }}
          />
          <ActionIcon
            icon={TrashIcon}
            size={'small'}
            title={t('translate.clear', { ns: 'chat' })}
            onClick={() => {
              clearTranslate(id);
            }}
          />
          <ActionIcon
            icon={show ? ChevronDown : ChevronUp}
            size={'small'}
            onClick={() => {
              setShow(!show);
            }}
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
