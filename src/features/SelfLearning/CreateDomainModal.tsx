'use client';

import { Flexbox, Input, Text, TextArea } from '@lobehub/ui';
import { Button, createModal, ModalFooter, toast, useModalContext } from '@lobehub/ui/base-ui';
import { t as translate } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { expertiseService } from '@/services/expertise';

interface CreateDomainContentProps {
  agentId: string;
  onCreated: () => void;
}

/**
 * 手建一个专长。
 *
 * 领域过滤器是必填的，而且是这张表单的重点 —— 它是这个专长唯一可执行的判据：
 * 哪些对话算数、哪些不算。回测里它拒噪极准（后端运维 77% 的实践空手而归，
 * 重复的 DNS 话题全被挡在外面）；留空的话这个专长会把什么都往里学。
 *
 * 人自己写下的过滤器**就是一个已选定的锚点**，所以建完直接进入可练状态，
 * 不再要求人去「确认方向」—— 他刚刚做的就是那件事。
 */
const CreateDomainContent = memo<CreateDomainContentProps>(({ agentId, onCreated }) => {
  const { t } = useTranslation('selfLearning');
  const { close } = useModalContext();
  const [title, setTitle] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!title.trim() || !domainFilter.trim()) return;
    setLoading(true);
    try {
      await expertiseService.createDomain({
        agentId,
        domainFilter: domainFilter.trim(),
        title: title.trim(),
      });
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
      <Flexbox gap={6}>
        <Text fontSize={13} weight={600}>
          {t('create.titleLabel')}
        </Text>
        <Input
          placeholder={t('create.titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Flexbox>
      <Flexbox gap={6}>
        <Text fontSize={13} weight={600}>
          {t('create.filterLabel')}
        </Text>
        <Text fontSize={12} lineHeight={1.7} type={'secondary'}>
          {t('create.filterHelp')}
        </Text>
        <TextArea
          placeholder={t('create.filterPlaceholder')}
          rows={4}
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
        />
      </Flexbox>
      <ModalFooter>
        <Button onClick={close}>{t('create.cancel')}</Button>
        <Button
          disabled={!title.trim() || !domainFilter.trim()}
          loading={loading}
          type={'primary'}
          onClick={submit}
        >
          {t('create.submit')}
        </Button>
      </ModalFooter>
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
  });
