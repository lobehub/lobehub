'use client';

import {
  ActionIcon,
  Button,
  createModal,
  Flexbox,
  Icon,
  Input,
  Spin,
  Text,
  TextArea,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeftIcon, PencilLineIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import GeneratingBorder from '@/components/GeneratingBorder';
import { expertiseService, type RuleGroup } from '@/services/expertise';
import { shinyTextStyles } from '@/styles';

export const composeStyles = stylex.create({
  body: {
    overflowY: 'auto',
    maxHeight: 'min(70vh, 640px)',
    paddingBlockStart: '4px',
    paddingBlockEnd: '20px',
    paddingInline: '20px',
  },
  close: {
    position: 'absolute',
    insetBlockStart: '14px',
    insetInlineEnd: '14px',
  },
  describe: {
    resize: 'none',
    width: '100%',
    minHeight: '150px',
    paddingBlock: '14px',
    paddingInline: '16px',
    borderWidth: 0,
    borderStyle: 'none',
    font: 'inherit',
    fontSize: '14px',
    lineHeight: 1.7,
    color: 'inherit',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    outlineStyle: 'none',
  },
  footer: {
    paddingBlock: '10px',
    paddingInline: '20px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  head: {
    position: 'relative',
    paddingBlockStart: '16px',
    paddingBlockEnd: '8px',
    paddingInline: '20px',
  },
  inputShell: {
    overflow: 'hidden',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  label: {
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  status: {
    minHeight: '32px',
    paddingBlock: '4px',
    color: cssVar.colorTextSecondary,
  },
  title: {
    boxSizing: 'border-box',
    width: '100%',
    paddingBlockStart: '4px',
    paddingBlockEnd: '8px',
    paddingInlineEnd: '40px',
    borderWidth: 0,
    borderStyle: 'none',
    fontFamily: 'inherit',
    fontSize: '20px',
    fontWeight: 600,
    lineHeight: 1.4,
    color: 'inherit',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    outlineStyle: 'none',
  },
  titleStatic: {
    paddingBlockStart: '4px',
    paddingBlockEnd: '8px',
    paddingInlineEnd: '40px',
    fontSize: '20px',
    fontWeight: 600,
    lineHeight: 1.4,
    color: cssVar.colorText,
  },
});

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
  // Ingestion reads this literally when deciding which rejections belong, so it is kept.
  const [outOfScope, setOutOfScope] = useState(group?.domain.outOfScope ?? '');
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
      setOutOfScope(drafted.outOfScope ?? '');
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
          outOfScope: outOfScope.trim() || null,
          title: title.trim(),
        });
        onDone();
      } else {
        const id = await expertiseService.createRuleGroup({
          gate: gate.trim(),
          outOfScope: outOfScope.trim() || undefined,
          title: title.trim(),
        });
        onDone(id ? { gate: gate.trim(), id, title: title.trim() } : undefined);
      }
      close();
    } catch (error) {
      console.error('[MemoryRules] group save failed:', error);
      toast.error(t('rules.saveFailed'));
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
      <Flexbox className={stylex.props(composeStyles.head).className} gap={6}>
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
        <div {...stylex.props(composeStyles.titleStatic)}>
          {t(group ? 'rules.group.renameTitle' : 'rules.group.newTitle')}
        </div>
        {step !== 'review' && (
          <>
            <GeneratingBorder
              className={stylex.props(composeStyles.inputShell).className}
              generating={step === 'preparing'}
            >
              <textarea
                autoFocus
                {...stylex.props(composeStyles.describe)}
                disabled={step === 'preparing'}
                placeholder={t('rules.group.describePlaceholder')}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
              />
            </GeneratingBorder>
            {step === 'preparing' && (
              <Flexbox
                horizontal
                align={'center'}
                className={stylex.props(composeStyles.status).className}
                gap={8}
              >
                <Spin size={'small'} variant={'network'} />
                <span className={shinyTextStyles.shinyText}>{t('rules.group.generating')}</span>
              </Flexbox>
            )}
          </>
        )}
        <ActionIcon
          className={stylex.props(composeStyles.close).className}
          icon={XIcon}
          onClick={() => close()}
        />
      </Flexbox>

      {step === 'review' && (
        <Flexbox className={stylex.props(composeStyles.body).className} gap={16}>
          <Flexbox gap={6}>
            <span {...stylex.props(composeStyles.label)}>{t('rules.group.nameLabel')}</span>
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
          </Flexbox>
          <Flexbox gap={6}>
            <span {...stylex.props(composeStyles.label)}>{t('rules.group.gateLabel')}</span>
            <TextArea
              autoSize={{ maxRows: 6, minRows: 2 }}
              placeholder={t('rules.group.gatePlaceholder')}
              value={gate}
              onChange={(e) => setGate(e.target.value)}
            />
          </Flexbox>
          <Flexbox gap={6}>
            <span {...stylex.props(composeStyles.label)}>{t('rules.group.outOfScopeLabel')}</span>
            <TextArea
              autoSize={{ maxRows: 4, minRows: 1 }}
              placeholder={t('rules.group.outOfScopePlaceholder')}
              value={outOfScope}
              onChange={(e) => setOutOfScope(e.target.value)}
            />
          </Flexbox>
        </Flexbox>
      )}

      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(composeStyles.footer).className}
        justify={'flex-end'}
      >
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
