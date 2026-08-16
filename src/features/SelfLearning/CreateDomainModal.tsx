'use client';

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
  content: css`
    margin-block-start: -10px;
  `,
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

/** Creates an expertise domain from one natural-language brief interpreted by the backend. */
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
      await expertiseService.createDomain({ agentId, brief: brief.trim() });
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
    <Flexbox className={styles.content} gap={8} padding={'0 20px 16px'}>
      <Text fontSize={12.5} lineHeight={1.7} type={'secondary'}>
        {loading ? t('create.generating') : t('create.briefHelp')}
      </Text>
      <TextArea
        autoFocus
        className={loading ? styles.generating : undefined}
        disabled={loading}
        placeholder={t('create.briefPlaceholder')}
        rows={5}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
      />
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
    title: translate('create.modalTitle', { ns: 'selfLearning' }),
    width: 'min(88vw, 560px)',
  });
