'use client';

import { Flexbox, Input, Text, TextArea } from '@lobehub/ui';
import { Button, createModal, toast, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, keyframes } from 'antd-style';
import { t as translate } from 'i18next';
import { ArrowLeftIcon, RefreshCwIcon, SparklesIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainDraft } from '@/services/expertise';
import { expertiseService } from '@/services/expertise';

interface CreateDomainContentProps {
  agentId: string;
  onCreated: (domainId: string) => void;
}

const shimmer = keyframes`
  to { background-position: 200% 0; }
`;

const styles = createStaticStyles(({ css }) => ({
  content: css`
    margin-block-start: -10px;
  `,
  field: css`
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 12px;
    align-items: start;
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
  step: css`
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 11.5px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
  stepActive: css`
    color: ${cssVar.colorBgContainer};
    background: ${cssVar.colorText};
  `,
}));

/**
 * 两步建域：① 一句话说清方向 → ② 检查它读出来的名字 / 什么算实践 / 什么不算，再创建。
 * 这三个字段决定它从哪些对话里学 —— 值得让人看一眼，而不是生成即落库。
 */
const CreateDomainContent = memo<CreateDomainContentProps>(({ agentId, onCreated }) => {
  const { t } = useTranslation('selfLearning');
  const { close } = useModalContext();
  const storageKey = `self-learning:create:${agentId}`;
  const [brief, setBrief] = useState(() => localStorage.getItem(storageKey) ?? '');
  const [draft, setDraft] = useState<ExpertiseDomainDraft>();
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

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

  const generate = async () => {
    if (!brief.trim()) return;
    setLoading(true);
    try {
      setDraft(await expertiseService.draftDomain({ agentId, brief: brief.trim() }));
    } catch {
      toast.error(t('create.failed'));
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    if (!draft || !draft.title.trim() || !draft.domainFilter.trim()) return;
    setCreating(true);
    try {
      const id = await expertiseService.createDomain({
        agentId,
        brief: brief.trim(),
        domainFilter: draft.domainFilter.trim(),
        outOfScope: draft.outOfScope?.trim() || null,
        title: draft.title.trim(),
      });
      localStorage.removeItem(storageKey);
      onCreated(id);
      close();
    } catch {
      toast.error(t('create.failed'));
    } finally {
      setCreating(false);
    }
  };

  const step = draft ? 2 : 1;

  return (
    <Flexbox className={styles.content} gap={12} padding={'0 20px 16px'}>
      <Flexbox horizontal align={'center'} gap={6}>
        <span className={`${styles.step} ${step === 1 ? styles.stepActive : ''}`}>
          1 · {t('create.step1')}
        </span>
        <span className={`${styles.step} ${step === 2 ? styles.stepActive : ''}`}>
          2 · {t('create.step2')}
        </span>
      </Flexbox>

      {step === 1 ? (
        <>
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
              type={'primary'}
              onClick={generate}
            >
              {loading ? t('create.generating') : t('create.generate')}
            </Button>
          </Flexbox>
        </>
      ) : (
        <>
          <Text fontSize={12.5} lineHeight={1.7} type={'secondary'}>
            {t('create.reviewHelp')}
          </Text>
          <Flexbox gap={12}>
            <div className={styles.field}>
              <Text fontSize={13} weight={500}>
                {t('create.field.title')}
              </Text>
              <Input
                maxLength={80}
                value={draft!.title}
                onChange={(e) => setDraft({ ...draft!, title: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <Text fontSize={13} weight={500}>
                {t('create.field.domainFilter')}
              </Text>
              <TextArea
                autoSize={{ maxRows: 6, minRows: 3 }}
                value={draft!.domainFilter}
                onChange={(e) => setDraft({ ...draft!, domainFilter: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <Text fontSize={13} weight={500}>
                {t('create.field.outOfScope')}
              </Text>
              <TextArea
                autoSize={{ maxRows: 5, minRows: 2 }}
                value={draft!.outOfScope ?? ''}
                onChange={(e) => setDraft({ ...draft!, outOfScope: e.target.value })}
              />
            </div>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Flexbox horizontal gap={8}>
              <Button
                disabled={creating}
                icon={ArrowLeftIcon}
                type={'text'}
                onClick={() => setDraft(undefined)}
              >
                {t('create.back')}
              </Button>
              <Button
                disabled={creating}
                icon={RefreshCwIcon}
                loading={loading}
                type={'text'}
                onClick={generate}
              >
                {t('create.regenerate')}
              </Button>
            </Flexbox>
            <Button
              disabled={!draft!.title.trim() || !draft!.domainFilter.trim() || creating}
              loading={creating}
              type={'primary'}
              onClick={create}
            >
              {t('create.confirm')}
            </Button>
          </Flexbox>
        </>
      )}
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
    width: 'min(88vw, 600px)',
  });
