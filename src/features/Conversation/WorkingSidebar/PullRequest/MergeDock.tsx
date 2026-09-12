import type { DeviceGitPullRequestAction, DeviceGitPullRequestDetail } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Checkbox, ScrollArea } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ArrowUpIcon, ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { OverviewRow } from '../Overview/OverviewRow';
import ChecksList from './ChecksList';
import DockActionButton from './DockActionButton';
import { type DockRow, type MergeDockInput, resolveMergeDock } from './mergeDockData';
import { readMergeMethod, writeMergeMethod } from './mergeMethodStorage';
import { DOCK_ICON, TONE_COLOR, type TranslateKey } from './prVisual';
import type { PullRequestBusy } from './usePullRequestActions';

const BUSY_MAP: Partial<Record<PullRequestBusy, NonNullable<MergeDockInput['ui']['busy']>>> = {
  autoMerge: 'autoMerge',
  merge: 'merge',
  ready: 'ready',
  updateBranch: 'update',
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionBar: css`
    padding-block: 6px 0;
    padding-inline: 8px;
  `,
  bypass: css`
    padding-block: 4px 0;
    padding-inline: 8px;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  checks: css`
    max-height: 200px;
  `,
  dock: css`
    flex-shrink: 0;

    padding-block: 8px 10px;
    padding-inline: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  hint: css`
    padding-block: 4px 0;
    padding-inline: 8px;

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface MergeDockProps {
  busy?: PullRequestBusy;
  detail: DeviceGitPullRequestDetail;
  error?: string;
  local?: MergeDockInput['local'];
  onAction: (action: DeviceGitPullRequestAction) => Promise<boolean>;
  onDismissError: () => void;
  onPush: () => Promise<boolean>;
  onRetry: () => void;
}

const MergeDock = memo<MergeDockProps>(
  ({ busy, detail, error, local, onAction, onDismissError, onPush, onRetry }) => {
    const { t } = useTranslation('chat');
    const { t: tCommon } = useTranslation('common');
    const tr = t as unknown as TranslateKey;
    const [bypass, setBypass] = useState(false);
    const [method, setMethod] = useState(readMergeMethod);
    const [checksOpen, setChecksOpen] = useState(false);

    const model = resolveMergeDock({
      detail,
      local,
      ui: { busy: busy && BUSY_MAP[busy], bypass, error, method },
    });

    const rowTrailing = (row: DockRow) => {
      switch (row.key) {
        case 'checks': {
          return <Icon icon={checksOpen ? ChevronDownIcon : ChevronRightIcon} size={12} />;
        }
        case 'autoMerge': {
          return (
            <Button
              loading={busy === 'disableAutoMerge'}
              size={'small'}
              type={'text'}
              onClick={() => void onAction({ type: 'disableAutoMerge' })}
            >
              {t('workingPanel.pr.action.disableAutoMerge')}
            </Button>
          );
        }
        case 'error': {
          return (
            <>
              <Button size={'small'} type={'text'} onClick={onDismissError}>
                {t('workingPanel.pr.dismiss')}
              </Button>
              <Button size={'small'} type={'text'} onClick={onRetry}>
                {tCommon('retry')}
              </Button>
            </>
          );
        }
        default: {
          return row.trailingKey ? tr(row.trailingKey, row.trailingParams) : undefined;
        }
      }
    };

    return (
      <div className={styles.dock}>
        {model.rows.map((row) => {
          const label = tr(row.labelKey, row.labelParams);
          return (
            <Flexbox key={row.key}>
              <OverviewRow
                icon={DOCK_ICON[row.icon]}
                iconColor={TONE_COLOR[row.tone]}
                spin={row.icon === 'spinner'}
                title={row.key === 'error' ? label : undefined}
                trailing={rowTrailing(row)}
                value={label}
                weak={row.tone === 'neutral'}
                onClick={row.expandable ? () => setChecksOpen((open) => !open) : undefined}
              />
              {row.key === 'checks' && checksOpen && (
                <ScrollArea disableContentFit className={styles.checks}>
                  <ChecksList checks={detail.checks} />
                </ScrollArea>
              )}
            </Flexbox>
          );
        })}
        {model.showBypass && (
          <div className={styles.bypass}>
            <Checkbox checked={bypass} onChange={setBypass}>
              {t('workingPanel.pr.bypass')}
            </Checkbox>
          </div>
        )}
        {model.action && (
          <Flexbox horizontal align={'center'} className={styles.actionBar} gap={8}>
            {model.showPush && (
              <Button
                icon={<Icon icon={ArrowUpIcon} size={12} />}
                loading={busy === 'push'}
                size={'small'}
                onClick={() => void onPush()}
              >
                {busy === 'push'
                  ? t('workingPanel.pr.action.pushing')
                  : t('workingPanel.pr.action.push', { count: local?.ahead ?? 0 })}
              </Button>
            )}
            <DockActionButton
              action={model.action}
              busy={busy}
              detail={detail}
              onAction={onAction}
              onPickMethod={(next) => {
                setMethod(next);
                writeMergeMethod(next);
              }}
            />
          </Flexbox>
        )}
        {model.hintKey && <div className={styles.hint}>{tr(model.hintKey, model.hintParams)}</div>}
      </div>
    );
  },
);

MergeDock.displayName = 'PullRequestMergeDock';

export default MergeDock;
