import type { DeviceGitPullRequestAction, DeviceGitPullRequestDetail } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button, ScrollArea } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { ArrowUpIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ChecksList from './ChecksList';
import DockActionButton from './DockActionButton';
import { type DockAction, type MergeDockInput, resolveMergeDock } from './mergeDockData';
import { readMergeMethod, writeMergeMethod } from './mergeMethodStorage';
import { DOCK_ICON, TONE_COLOR, type TranslateKey } from './prVisual';
import type { PullRequestBusy } from './usePullRequestActions';

const BUSY_MAP: Partial<Record<PullRequestBusy, NonNullable<MergeDockInput['ui']['busy']>>> = {
  autoMerge: 'autoMerge',
  merge: 'merge',
  ready: 'ready',
  updateBranch: 'update',
};

const UPDATE_BRANCH: DockAction = { kind: 'updateBranch', tone: 'success' };

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionBar: css`
    flex-wrap: wrap;
    padding-block-start: 10px;
  `,
  checks: css`
    margin-inline-start: 22px;

    > summary {
      cursor: pointer;

      display: flex;
      gap: 4px;
      align-items: center;

      font-size: 12px;
      line-height: 18px;
      color: ${cssVar.colorTextTertiary};
      list-style: none;

      &::-webkit-details-marker {
        display: none;
      }
    }

    &[open] > summary svg {
      transform: rotate(90deg);
    }
  `,
  checksList: css`
    max-height: min(240px, 35vh);
  `,
  dock: css`
    flex-shrink: 0;

    padding-block: 10px 12px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  local: css`
    flex-shrink: 0;

    padding-block: 10px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  headline: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 13px;
    font-weight: 600;
    line-height: 20px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  headlineWrap: css`
    overflow-wrap: anywhere;
    white-space: normal;
  `,
  icon: css`
    flex-shrink: 0;
  `,
  sub: css`
    padding-inline-start: 22px;

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
    overflow-wrap: anywhere;
  `,
  trailing: css`
    flex-shrink: 0;
    margin-inline-end: -6px;
  `,
}));

interface MergeDockProps {
  busy?: PullRequestBusy;
  contextLoading?: boolean;
  detail: DeviceGitPullRequestDetail;
  error?: string;
  local?: MergeDockInput['local'];
  onAction: (action: DeviceGitPullRequestAction) => Promise<boolean>;
  onDismissError: () => void;
  onPush: () => Promise<boolean>;
  onRetry: () => void;
}

const MergeDock = memo<MergeDockProps>(
  ({ busy, contextLoading, detail, error, local, onAction, onDismissError, onPush, onRetry }) => {
    const { t } = useTranslation('chat');
    const { t: tCommon } = useTranslation('common');
    const tr = t as unknown as TranslateKey;
    const [bypass, setBypass] = useState(false);
    const [method, setMethod] = useState(readMergeMethod);

    const model = resolveMergeDock({
      detail,
      local,
      ui: { busy: busy && BUSY_MAP[busy], bypass, contextLoading, error, method },
    });
    const { status } = model;
    const isError = status.key === 'error';
    const hasFailedChecks = detail.checks.some(
      (check) => check.status === 'failure' || check.status === 'cancelled',
    );
    const reasons = model.reasons
      .map((reason) => tr(reason.labelKey, reason.labelParams))
      .join(' · ');

    return (
      <>
        {model.showPush && (
          <Flexbox
            horizontal
            align={'center'}
            className={styles.local}
            gap={8}
            justify={'space-between'}
          >
            <span>{t('workingPanel.pr.reason.localAhead', { count: local?.ahead ?? 0 })}</span>
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
          </Flexbox>
        )}
        <div className={styles.dock}>
          <Flexbox horizontal align={'flex-start'} gap={8}>
            <Icon
              className={styles.icon}
              color={TONE_COLOR[status.tone]}
              icon={DOCK_ICON[status.icon]}
              size={14}
              spin={status.icon === 'spinner'}
              style={{ marginBlockStart: 3 }}
            />
            <span
              className={cx(styles.headline, isError && styles.headlineWrap)}
              style={isError ? { color: TONE_COLOR.error } : undefined}
            >
              {tr(status.labelKey, status.labelParams)}
            </span>
            {isError && (
              <Flexbox horizontal className={styles.trailing} gap={2}>
                <Button size={'small'} type={'text'} onClick={onDismissError}>
                  {t('workingPanel.pr.dismiss')}
                </Button>
                <Button size={'small'} type={'text'} onClick={onRetry}>
                  {tCommon('retry')}
                </Button>
              </Flexbox>
            )}
            {status.key === 'autoMerge' && (
              <Button
                className={styles.trailing}
                loading={busy === 'disableAutoMerge'}
                size={'small'}
                type={'text'}
                onClick={() => void onAction({ type: 'disableAutoMerge' })}
              >
                {t('workingPanel.pr.action.disableAutoMerge')}
              </Button>
            )}
          </Flexbox>
          {model.reasons.length > 0 &&
            (hasFailedChecks ? (
              <details className={styles.checks}>
                <summary>
                  <Icon icon={ChevronRightIcon} size={12} />
                  {reasons}
                </summary>
                <ScrollArea
                  disableContentFit
                  scrollFade
                  style={{ marginBlockStart: 6 }}
                  viewportProps={{
                    'aria-label': t('workingPanel.pr.section.checks'),
                    'className': styles.checksList,
                    'role': 'region',
                    'tabIndex': 0,
                  }}
                >
                  <ChecksList checks={detail.checks} />
                </ScrollArea>
              </details>
            ) : (
              <div className={styles.sub}>{reasons}</div>
            ))}
          {model.hintKey && <div className={styles.sub}>{tr(model.hintKey, model.hintParams)}</div>}
          {model.action && (
            <Flexbox horizontal align={'center'} className={styles.actionBar} gap={8}>
              {model.showUpdateBranch && (
                <DockActionButton
                  secondary
                  action={UPDATE_BRANCH}
                  busy={busy}
                  detail={detail}
                  onAction={onAction}
                  onPickMethod={() => {}}
                  onToggleBypass={() => {}}
                />
              )}
              <DockActionButton
                action={model.action}
                busy={busy}
                bypass={model.bypassAvailable ? bypass : undefined}
                detail={detail}
                onAction={onAction}
                onToggleBypass={setBypass}
                onPickMethod={(next) => {
                  setMethod(next);
                  writeMergeMethod(next);
                }}
              />
            </Flexbox>
          )}
        </div>
      </>
    );
  },
);

MergeDock.displayName = 'PullRequestMergeDock';

export default MergeDock;
