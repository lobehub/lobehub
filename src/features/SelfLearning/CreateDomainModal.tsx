'use client';

import { parseExpertiseDomainBrief } from '@lobechat/types';
import { Flexbox, Text, TextArea } from '@lobehub/ui';
import { Button, createModal, toast, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, keyframes } from 'antd-style';
import { t as translate } from 'i18next';
import { SparklesIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { expertiseService } from '@/services/expertise';

interface CreateDomainContentProps {
  agentId: string;
  onCreated: () => void;
}

const shimmer = keyframes`
  to { background-position: 200% 0; }
`;

const styles = createStaticStyles(({ css }) => ({
  generating: css`
    border-color: transparent;
    background:
      linear-gradient(${cssVar.colorBgElevated}, ${cssVar.colorBgElevated}) padding-box,
      linear-gradient(90deg, ${cssVar.colorPrimary}, ${cssVar.colorInfo}, ${cssVar.colorPrimary})
        border-box;
    background-size:
      100% 100%,
      200% 100%;
    animation: ${shimmer} 1.5s linear infinite;
  `,
}));

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
  const storageKey = `self-learning:create:${agentId}`;
  const [brief, setBrief] = useState(() => localStorage.getItem(storageKey) ?? '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (brief.trim()) localStorage.setItem(storageKey, brief);
    else localStorage.removeItem(storageKey);
  }, [brief, storageKey]);

  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (!brief.trim()) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [brief]);

  const submit = async () => {
    if (!brief.trim()) return;
    setLoading(true);
    try {
      const draft = parseExpertiseDomainBrief(brief);
      await expertiseService.createDomain({ agentId, brief, ...draft });
      localStorage.removeItem(storageKey);
      onCreated();
      close();
    } catch {
      toast.error(t('create.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={12} padding={'8px 20px 20px'}>
      <TextArea
        autoFocus
        className={loading ? styles.generating : undefined}
        disabled={loading}
        placeholder={t('create.briefPlaceholder')}
        rows={5}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
      />
      <Text fontSize={12.5} lineHeight={1.7} type={'secondary'}>
        {loading ? t('create.generating') : t('create.briefHelp')}
      </Text>
      <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
        <Button disabled={loading} onClick={close}>
          {t('create.cancel')}
        </Button>
        <Button
          disabled={!brief.trim() || loading}
          icon={SparklesIcon}
          loading={loading}
          shape={'round'}
          type={'primary'}
          onClick={submit}
        >
          {loading ? t('create.generating') : t('create.submit')}
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
    maskClosable: false,
    styles: { content: { padding: 0 } },
    title: translate('create.modalTitle', { ns: 'selfLearning' }),
    width: 'min(88vw, 560px)',
  });
