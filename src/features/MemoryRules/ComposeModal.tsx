'use client';

import type { ExpertiseEnforcement } from '@lobechat/types';
import { Flexbox, Icon, TextArea } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  createModal,
  DropdownMenu,
  Text,
  toast,
  Tooltip,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ArrowLeftIcon,
  BellIcon,
  ChevronDownIcon,
  ClipboardCheckIcon,
  FolderIcon,
  FolderPlusIcon,
  PencilLineIcon,
  ShieldCheckIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import GeneratingBorder from '@/components/GeneratingBorder';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { expertiseService, type RuleDraft, type RuleGroup } from '@/services/expertise';
import { shinyTextStyles } from '@/styles';

import { composeStyles, type CreatedGroup, createGroupModal } from './GroupModal';
import { useScopeLabel } from './labels';

const styles = createStaticStyles(({ css }) => ({
  chip: css`
    cursor: pointer;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    font-size: 12.5px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  field: css`
    font-size: 13px;
  `,
}));

type Compilability = 'compiled' | 'compilable' | 'not-compilable';

interface GroupChoice {
  gate: string;
  id: string;
  scopes: RuleGroup['scopes'];
  title: string;
}

interface ComposeContentProps {
  defaultGroupId?: string;
  groups: RuleGroup[];
  onCreated: (id: string) => void;
}

/**
 * Writing a rule works like creating a goal: say it in a sentence or paste a document, let the
 * model draft the rule and its fields, then correct anything before it is saved. "Write it
 * myself" skips the draft and lands on the same review form.
 */
const ComposeContent = ({
  defaultGroupId,
  groups: initialGroups,
  onCreated,
}: ComposeContentProps) => {
  const { t } = useTranslation('memory');
  const { close } = useModalContext();
  const scopeLabel = useScopeLabel();
  const [step, setStep] = useState<'describe' | 'preparing' | 'review'>('describe');
  const [brief, setBrief] = useState('');
  const [groups, setGroups] = useState<GroupChoice[]>(() =>
    initialGroups.map((group) => ({
      gate: group.domain.domainFilter,
      id: group.domain.id,
      scopes: group.scopes,
      title: group.domain.title,
    })),
  );
  const [groupId, setGroupId] = useState<string | undefined>(defaultGroupId ?? groups[0]?.id);
  const [newGroup, setNewGroup] = useState<RuleDraft['newGroup']>(null);
  const [title, setTitle] = useState('');
  const [why, setWhy] = useState('');
  const [how, setHow] = useState('');
  const [limits, setLimits] = useState('');
  const [enforcement, setEnforcement] = useState<ExpertiseEnforcement>('remind');
  const [compilability, setCompilability] = useState<Compilability>('not-compilable');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  const group = groups.find((g) => g.id === groupId);
  const generating = [
    t('rules.compose.generating'),
    t('rules.compose.generatingTitle'),
    t('rules.compose.generatingFields'),
    t('rules.compose.generatingGroup'),
  ];

  useEffect(() => {
    if (step !== 'preparing') return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 2400);
    return () => window.clearInterval(timer);
  }, [step]);

  const draft = async () => {
    const text = brief.trim();
    if (!text) return;
    setStep('preparing');
    try {
      const drafted = await expertiseService.draftRule({
        brief: text,
        groups: groups.map(({ gate, id, title: groupTitle }) => ({ gate, id, title: groupTitle })),
      });
      setTitle(drafted.title);
      setWhy(drafted.why ?? '');
      setHow(drafted.how ?? '');
      setLimits(drafted.limits ?? '');
      setEnforcement(drafted.enforcement);
      setCompilability(drafted.compilability);
      if (drafted.groupId) {
        setGroupId(drafted.groupId);
        setNewGroup(null);
      } else if (drafted.newGroup) {
        setGroupId(undefined);
        setNewGroup(drafted.newGroup);
      }
    } catch (error) {
      console.error('[MemoryRules] rule draft failed:', error);
      setTitle(text.split('\n')[0].slice(0, 120));
      toast.warning(t('rules.compose.generateFailed'));
    }
    setStep('review');
  };

  const addGroup = () =>
    createGroupModal({
      onDone: (created?: CreatedGroup) => {
        if (!created) return;
        setGroups((current) => [...current, { ...created, scopes: [] }]);
        setGroupId(created.id);
        setNewGroup(null);
      },
    });

  const submit = async () => {
    if (!title.trim() || busy) return;
    if (!groupId && !newGroup) {
      toast.warning(t('rules.compose.needGroup'));
      return;
    }
    setBusy(true);
    try {
      const domainId =
        groupId ??
        (await expertiseService.createRuleGroup({ gate: newGroup!.gate, title: newGroup!.title }));
      if (!domainId) return;
      const created = await expertiseService.createRule({
        compilability,
        domainId,
        enforcement,
        how: how.trim() || undefined,
        limits: limits.trim() || undefined,
        title: title.trim(),
        why: why.trim() || undefined,
      });
      if (created) onCreated(created.id);
      close();
    } finally {
      setBusy(false);
    }
  };

  const groupLabel = group
    ? group.title
    : newGroup
      ? t('rules.compose.newGroupProposed', { title: newGroup.title })
      : t('rules.compose.noGroup');

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
        {step === 'review' && (
          <Flexbox horizontal align={'center'} gap={8}>
            <ActionIcon
              icon={ArrowLeftIcon}
              size={'small'}
              title={t('rules.compose.back')}
              onClick={() => setStep('describe')}
            />
            <Text fontSize={12} type={'secondary'}>
              {t('rules.compose.reviewStep')}
            </Text>
          </Flexbox>
        )}
        {step === 'review' ? (
          <input
            autoFocus
            className={composeStyles.title}
            placeholder={t('rules.compose.titlePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        ) : (
          <div className={composeStyles.titleStatic}>{t('rules.compose.describeTitle')}</div>
        )}
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
                placeholder={t('rules.compose.describePlaceholder')}
                style={{ minHeight: 190 }}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
              />
            </GeneratingBorder>
            {step === 'preparing' ? (
              <Flexbox horizontal align={'center'} className={composeStyles.status} gap={8}>
                <NeuralNetworkLoading size={18} />
                <span className={shinyTextStyles.shinyText}>
                  {generating[tick % generating.length]}
                </span>
              </Flexbox>
            ) : (
              <Text type={'secondary'}>{t('rules.compose.describeHint')}</Text>
            )}
          </>
        )}
        <ActionIcon className={composeStyles.close} icon={XIcon} onClick={() => close()} />
      </Flexbox>

      {step === 'review' && (
        <Flexbox className={composeStyles.body} gap={14}>
          <Flexbox gap={4}>
            <span className={composeStyles.label}>{t('rules.compose.why')}</span>
            <TextArea
              autoSize={{ maxRows: 6, minRows: 1 }}
              className={styles.field}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
            />
          </Flexbox>
          <Flexbox gap={4}>
            <span className={composeStyles.label}>{t('rules.compose.how')}</span>
            <TextArea
              autoSize={{ maxRows: 6, minRows: 1 }}
              className={styles.field}
              value={how}
              onChange={(e) => setHow(e.target.value)}
            />
          </Flexbox>
          <Flexbox gap={4}>
            <span className={composeStyles.label}>{t('rules.compose.limits')}</span>
            <TextArea
              autoSize={{ maxRows: 6, minRows: 1 }}
              className={styles.field}
              value={limits}
              onChange={(e) => setLimits(e.target.value)}
            />
          </Flexbox>
        </Flexbox>
      )}

      <Flexbox
        horizontal
        align={'center'}
        className={composeStyles.footer}
        gap={8}
        justify={'space-between'}
      >
        <Flexbox horizontal align={'center'} gap={2} wrap={'wrap'}>
          {step === 'review' && (
            <>
              <DropdownMenu
                items={[
                  ...groups.map((g) => ({
                    key: g.id,
                    label: g.title,
                    onClick: () => {
                      setGroupId(g.id);
                      setNewGroup(null);
                    },
                  })),
                  ...(newGroup
                    ? [
                        {
                          key: 'proposed',
                          label: t('rules.compose.newGroupProposed', { title: newGroup.title }),
                          onClick: () => setGroupId(undefined),
                        },
                      ]
                    : []),
                  { type: 'divider' as const },
                  {
                    icon: <Icon icon={FolderPlusIcon} />,
                    key: 'new',
                    label: t('rules.actions.newGroup'),
                    onClick: addGroup,
                  },
                ]}
              >
                <span className={styles.chip}>
                  <Icon icon={newGroup && !group ? FolderPlusIcon : FolderIcon} size={13} />
                  {groupLabel}
                  <Icon icon={ChevronDownIcon} size={12} />
                </span>
              </DropdownMenu>
              <DropdownMenu
                items={[
                  {
                    key: 'remind',
                    label: t('rules.compose.enforcementRemind'),
                    onClick: () => setEnforcement('remind'),
                  },
                  {
                    key: 'block',
                    label: t('rules.compose.enforcementBlock'),
                    onClick: () => setEnforcement('block'),
                  },
                ]}
              >
                <span className={styles.chip}>
                  <Icon icon={enforcement === 'block' ? ShieldCheckIcon : BellIcon} size={13} />
                  {t(
                    enforcement === 'block'
                      ? 'rules.enforcement.block'
                      : 'rules.enforcement.remind',
                  )}
                  <Icon icon={ChevronDownIcon} size={12} />
                </span>
              </DropdownMenu>
              <DropdownMenu
                items={(['compiled', 'compilable', 'not-compilable'] as const).map((value) => ({
                  key: value,
                  label: t(`rules.method.${value}`),
                  onClick: () => setCompilability(value),
                }))}
              >
                <span className={styles.chip}>
                  <Icon icon={ClipboardCheckIcon} size={13} />
                  {t(`rules.method.${compilability}`)}
                  <Icon icon={ChevronDownIcon} size={12} />
                </span>
              </DropdownMenu>
              {group && group.scopes.length > 0 && (
                <Tooltip title={t('rules.group.gate', { gate: group.gate })}>
                  <span className={styles.chip} style={{ cursor: 'default' }}>
                    {t('rules.compose.scope', { scopes: scopeLabel(group.scopes) })}
                  </span>
                </Tooltip>
              )}
            </>
          )}
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={4}>
          {step === 'describe' && (
            <Button
              icon={<Icon icon={PencilLineIcon} />}
              style={{ color: cssVar.colorTextTertiary }}
              type={'text'}
              onClick={() => setStep('review')}
            >
              {t('rules.compose.blank')}
            </Button>
          )}
          <Button
            disabled={step === 'describe' ? !brief.trim() : !title.trim()}
            loading={busy || step === 'preparing'}
            type={'primary'}
            onClick={() => void (step === 'describe' ? draft() : submit())}
          >
            {step === 'describe' ? t('rules.compose.next') : t('rules.compose.submit')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};

export const createComposeRuleModal = (props: ComposeContentProps) =>
  createModal({
    content: <ComposeContent {...props} />,
    footer: null,
    maskClosable: false,
    styles: { content: { overflow: 'hidden', padding: 0 } },
    title: null,
    width: 'min(88vw, 720px)',
  });
