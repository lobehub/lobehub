'use client';

import { parseExpertiseDomainBrief } from '@lobechat/types';
import { Flexbox, Input, Text, TextArea } from '@lobehub/ui';
import { Button, createModal, toast, useModalContext } from '@lobehub/ui/base-ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { expertiseService } from '@/services/expertise';

interface CreateDomainContentProps {
  agentId: string;
  onCreated: () => void;
}

/**
 * 一句话建一个专长。
 *
 * 验收原话是「填写太麻烦了，能否改成一个输入框直接填写，然后我们做后台解析」。所以这里
 * 只剩一个框：你说想让它在什么事情上变强、什么不算，名称由后端拆出来。
 *
 * 那句话本身会原样成为领域过滤器 —— 它是这个专长唯一可执行的判据，不做改写：
 * 替用户改写判断标准，等于替他改了这个专长将来会学什么。
 */
const CreateDomainContent = memo<CreateDomainContentProps>(({ agentId, onCreated }) => {
  const { t } = useTranslation('selfLearning');
  const { close } = useModalContext();
  const [brief, setBrief] = useState('');
  const [draft, setDraft] = useState<ReturnType<typeof parseExpertiseDomainBrief>>();
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!brief.trim()) return;
    setLoading(true);
    try {
      if (!draft) return;
      await expertiseService.createDomain({ agentId, brief, ...draft });
      onCreated();
      close();
    } catch {
      toast.error(t('create.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={16} padding={20}>
      <Text fontSize={13} lineHeight={1.75} type={'secondary'}>
        {t('create.briefHelp')}
      </Text>
      {draft ? (
        <Flexbox gap={12}>
          <Text fontSize={12} type={'secondary'} weight={600}>
            {t('create.parsedTitle')}
          </Text>
          <Input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <Text fontSize={12} type={'secondary'} weight={600}>
            {t('create.parsedFilter')}
          </Text>
          <TextArea
            rows={4}
            value={draft.domainFilter}
            onChange={(e) => setDraft({ ...draft, domainFilter: e.target.value })}
          />
        </Flexbox>
      ) : (
        <TextArea
          autoFocus
          placeholder={t('create.briefPlaceholder')}
          rows={4}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
        />
      )}
      <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
        <Button onClick={close}>{t('create.cancel')}</Button>
        <Button
          disabled={draft ? !draft.title.trim() || !draft.domainFilter.trim() : !brief.trim()}
          loading={loading}
          type={'primary'}
          onClick={draft ? submit : () => setDraft(parseExpertiseDomainBrief(brief))}
        >
          {draft ? t('create.submit') : t('create.parse')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

CreateDomainContent.displayName = 'CreateDomainContent';

export const openCreateDomainModal = (props: CreateDomainContentProps) =>
  createModal({
    content: <CreateDomainContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: { content: { padding: 0 } },
    title: translate('create.modalTitle', { ns: 'selfLearning' }),
    width: 'min(88vw, 560px)',
  });
