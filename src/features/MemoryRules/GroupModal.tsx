'use client';

import { Flexbox, Icon, TextArea } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  createModal,
  Input,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeftIcon, PencilLineIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import GeneratingBorder from '@/components/GeneratingBorder';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { expertiseService, type RuleGroup } from '@/services/expertise';
import { shinyTextStyles } from '@/styles';

export const composeStyles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    max-height: min(70vh, 640px);
    padding-block: 4px 20px;
    padding-inline: 20px;
  `,
  close: css`
    position: absolute;
    inset-block-start: 14px;
    inset-inline-end: 14px;
  `,
  describe: css`
    resize: none;

    width: 100%;
    min-height: 150px;
    padding-block: 14px;
    padding-inline: 16px;
    border: none;

    font: inherit;
    font-size: 14px;
    line-height: 1.7;
    color: inherit;

    background: transparent;
    outline: none;
  `,
  footer: css`
    padding-block: 10px;
    padding-inline: 20px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  head: css`
    position: relative;
    padding-block: 16px 8px;
    padding-inline: 20px;
  `,
  inputShell: css`
    overflow: hidden;
    background: ${cssVar.colorBgElevated};
  `,
  label: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  status: css`
    min-height: 32px;
    padding-block: 4px;
    color: ${cssVar.colorTextSecondary};
  `,
  title: css`
    box-sizing: border-box;
    width: 100%;
    padding-block: 4px 8px;
    padding-inline-end: 40px;
    border: none;

    font-family: inherit;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.4;
    color: inherit;

    background: transparent;
    outline: none;
  `,
  titleStatic: css`
    padding-block: 4px 8px;
    padding-inline-end: 40px;

    font-size: 20px;
    font-weight: 600;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
}));

export interface CreatedGroup {
  gate: string;
  id: string;
  title: string;
}

interface GroupContentProps {
  /** Present when renaming; absent when opening a new group. */
  group?: RuleGroup;
  onDone: (created?: CreatedGroup) => void;
}

/**
 * Opening a group works like opening a goal: say what it is for, let the model draft the name and
 * the gate question, then correct either before it exists. Renaming skips the draft and lands on
 * the same review form.
 */
const GroupContent = ({ group, onDone }: GroupContentProps) => {
  const { t } = useTranslation('memory');
  const { close } = useModalContext();
  const [step, setStep] = useState<'describe' | 'preparing' | 'review'>(
    group ? 'review' : 'describe',
  );
  const [brief, setBrief] = useState('');
  const [title, setTitle] = useState(group?.domain.title ?? '');
  const [gate, setGate] = useState(group?.domain.domainFilter ?? '');
  const [busy, setBusy] = useState(false);
  const ready = Boolean(title.trim() && gate.trim());

  const draft = async () => {
    const text = brief.trim();
    if (!text) return;
    setStep('preparing');
    try {
      const drafted = await expertiseService.draftRuleGroup(text);
      setTitle(drafted.title);
      setGate(drafted.gate);
    } catch (error) {
      console.error('[MemoryRules] group draft failed:', error);
      setTitle(text.slice(0, 40));
      toast.warning(t('rules.group.generateFailed'));
    }
    setStep('review');
  };

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      if (group) {
        await expertiseService.updateRuleGroup(group.domain.id, {
          gate: gate.trim(),
          title: title.trim(),
        });
        onDone();
      } else {
        const id = await expertiseService.createRuleGroup({
          gate: gate.trim(),
          title: title.trim(),
        });
        onDone(id ? { gate: gate.trim(), id, title: title.trim() } : undefined);
      }
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flexbox
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void (step === 'describe' ? draft() : submit());
        }
      }}
    >
      <Flexbox className={composeStyles.head} gap={6}>
        {step === 'review' && !group && (
          <Flexbox horizontal align={'center'} gap={8}>
            <ActionIcon
              icon={ArrowLeftIcon}
              size={'small'}
              title={t('rules.group.back')}
              onClick={() => setStep('describe')}
            />
            <Text fontSize={12} type={'secondary'}>
              {t('rules.group.reviewStep')}
            </Text>
          </Flexbox>
        )}
        <div className={composeStyles.titleStatic}>
          {t(group ? 'rules.group.renameTitle' : 'rules.group.newTitle')}
        </div>
        {step !== 'review' && (
          <>
            <GeneratingBorder
              className={composeStyles.inputShell}
              generating={step === 'preparing'}
            >
              <textarea
                autoFocus
                className={composeStyles.describe}
                disabled={step === 'preparing'}
                placeholder={t('rules.group.describePlaceholder')}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
              />
            </GeneratingBorder>
            {step === 'preparing' && (
              <Flexbox horizontal align={'center'} className={composeStyles.status} gap={8}>
                <NeuralNetworkLoading size={18} />
                <span className={shinyTextStyles.shinyText}>{t('rules.group.generating')}</span>
              </Flexbox>
            )}
          </>
        )}
        <ActionIcon className={composeStyles.close} icon={XIcon} onClick={() => close()} />
      </Flexbox>

      {step === 'review' && (
        <Flexbox className={composeStyles.body} gap={16}>
          <Flexbox gap={6}>
            <span className={composeStyles.label}>{t('rules.group.nameLabel')}</span>
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
          </Flexbox>
          <Flexbox gap={6}>
            <span className={composeStyles.label}>{t('rules.group.gateLabel')}</span>
            <TextArea
              autoSize={{ maxRows: 6, minRows: 2 }}
              placeholder={t('rules.group.gatePlaceholder')}
              value={gate}
              onChange={(e) => setGate(e.target.value)}
            />
          </Flexbox>
        </Flexbox>
      )}

      <Flexbox horizontal align={'center'} className={composeStyles.footer} justify={'flex-end'}>
        <Flexbox horizontal align={'center'} gap={4}>
          {step === 'describe' && (
            <Button
              icon={<Icon icon={PencilLineIcon} />}
              style={{ color: cssVar.colorTextTertiary }}
              type={'text'}
              onClick={() => setStep('review')}
            >
              {t('rules.group.blank')}
            </Button>
          )}
          <Button
            disabled={step === 'describe' ? !brief.trim() : !ready}
            loading={busy || step === 'preparing'}
            type={'primary'}
            onClick={() => void (step === 'describe' ? draft() : submit())}
          >
            {step === 'describe'
              ? t('rules.group.next')
              : t(group ? 'rules.group.submitRename' : 'rules.group.submitCreate')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};

export const createGroupModal = (props: GroupContentProps) =>
  createModal({
    content: <GroupContent {...props} />,
    footer: null,
    maskClosable: false,
    styles: { content: { overflow: 'hidden', padding: 0 } },
    title: null,
    width: 'min(88vw, 560px)',
  });
