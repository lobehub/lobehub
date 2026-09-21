'use client';

import type { ExpertiseEnforcement } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button, createModal, DropdownMenu, Tooltip, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  BellIcon,
  ChevronDownIcon,
  ClipboardCheckIcon,
  FolderIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { expertiseService, type RuleGroup } from '@/services/expertise';

import { useScopeLabel } from './labels';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    padding-block: 8px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  body: css`
    resize: none;

    min-height: 120px;
    border: none;

    font: inherit;
    font-size: 14px;
    line-height: 1.7;
    color: inherit;

    background: transparent;
    outline: none;
  `,
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
  title: css`
    padding-block: 4px;
    border: none;

    font: inherit;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.4;
    color: inherit;

    background: transparent;
    outline: none;
  `,
}));

type Compilability = 'compiled' | 'compilable' | 'not-compilable';

interface ComposeContentProps {
  defaultGroupId?: string;
  groups: RuleGroup[];
  onCreated: (id: string) => void;
}

/**
 * Writing a rule looks like creating a task: a bare title, an optional note, and the settings as
 * chips along the bottom. The gate question lives in the placeholder so the reviewer reads it
 * before they type, not after.
 */
const ComposeContent = ({ defaultGroupId, groups, onCreated }: ComposeContentProps) => {
  const { t } = useTranslation('memory');
  const { close } = useModalContext();
  const scopeLabel = useScopeLabel();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [groupId, setGroupId] = useState(defaultGroupId ?? groups[0]?.domain.id);
  const [enforcement, setEnforcement] = useState<ExpertiseEnforcement>('remind');
  const [compilability, setCompilability] = useState<Compilability>('not-compilable');
  const [busy, setBusy] = useState(false);
  const group = groups.find((g) => g.domain.id === groupId);

  const submit = async () => {
    if (!title.trim() || !groupId || busy) return;
    setBusy(true);
    try {
      const created = await expertiseService.createRule({
        body: body.trim() || undefined,
        compilability,
        domainId: groupId,
        enforcement,
        title: title.trim(),
      });
      if (created) onCreated(created.id);
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flexbox>
      <Flexbox style={{ minHeight: 180, padding: '16px 24px 0' }}>
        <input
          autoFocus
          className={styles.title}
          placeholder={t('rules.compose.titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
          }}
        />
        <textarea
          className={styles.body}
          placeholder={t('rules.compose.bodyPlaceholder')}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </Flexbox>
      <Flexbox horizontal align={'center'} className={styles.bar} gap={8} justify={'space-between'}>
        <Flexbox horizontal gap={2} wrap={'wrap'}>
          <DropdownMenu
            items={groups.map((g) => ({
              key: g.domain.id,
              label: g.domain.title,
              onClick: () => setGroupId(g.domain.id),
            }))}
          >
            <span className={styles.chip}>
              <Icon icon={FolderIcon} size={13} />
              {group?.domain.title}
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
              {t(enforcement === 'block' ? 'rules.enforcement.block' : 'rules.enforcement.remind')}
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
          {group && (
            <Tooltip title={t('rules.group.gate', { gate: group.domain.domainFilter })}>
              <span className={styles.chip} style={{ cursor: 'default' }}>
                {t('rules.compose.scope', { scopes: scopeLabel(group.scopes) })}
              </span>
            </Tooltip>
          )}
        </Flexbox>
        <Button
          disabled={!title.trim() || !groupId}
          loading={busy}
          size={'small'}
          type={'primary'}
          onClick={() => void submit()}
        >
          {t('rules.compose.submit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

export const createComposeRuleModal = (props: ComposeContentProps) =>
  createModal({
    content: <ComposeContent {...props} />,
    footer: null,
    maskClosable: true,
    styles: { content: { overflow: 'hidden', padding: 0 } },
    title: null,
    width: 680,
  });
