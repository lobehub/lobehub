import type { DeviceGitPullRequestAction, DeviceGitPullRequestDetail } from '@lobechat/types';
import { Button, Flexbox, Icon, ScrollArea } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpIcon, ChevronRightIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import ChecksList from './ChecksList';
import DockActionButton from './DockActionButton';
import checksStyles from './MergeDock.module.css';
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

const styles = stylex.create({
  actionBar: { flexWrap: 'wrap', paddingBlockStart: '10px' },
  checksList: { maxHeight: 'min(240px, 35vh)' },
  dock: {
    flexShrink: 0,
    paddingBlockStart: '10px',
    paddingBlockEnd: '12px',
    paddingInline: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  headline: {
    overflow: 'hidden',
    flex: '1',
    minWidth: 0,
    fontSize: '13px',
    fontWeight: 600,
    lineHeight: '20px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  headlineWrap: { overflowWrap: 'anywhere', whiteSpace: 'normal' },
  icon: { flexShrink: 0 },
  local: {
    flexShrink: 0,
    paddingBlock: '10px',
    paddingInline: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  sub: {
    paddingInlineStart: '22px',
    fontSize: '12px',
    lineHeight: '18px',
    color: cssVar.colorTextTertiary,
    overflowWrap: 'anywhere',
  },
  trailing: { flexShrink: 0, marginInlineEnd: '-6px' },
});

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
            {...stylex.props(styles.local)}
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
        <div {...stylex.props(styles.dock)}>
          <Flexbox horizontal align={'flex-start'} gap={8}>
            <Icon
              color={TONE_COLOR[status.tone]}
              icon={DOCK_ICON[status.icon]}
              size={14}
              spin={status.icon === 'spinner'}
              {...sx([styles.icon], undefined, { marginBlockStart: 3 })}
            />
            <span
              {...sx(
                [styles.headline, isError && styles.headlineWrap],
                undefined,
                isError ? { color: TONE_COLOR.error } : undefined,
              )}
            >
              {tr(status.labelKey, status.labelParams)}
            </span>
            {isError && (
              <Flexbox horizontal className={stylex.props(styles.trailing).className} gap={2}>
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
                className={stylex.props(styles.trailing).className}
                disabled={contextLoading}
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
              <details className={checksStyles.checks}>
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
                    'className': stylex.props(styles.checksList).className,
                    'role': 'region',
                    'tabIndex': 0,
                  }}
                >
                  <ChecksList checks={detail.checks} />
                </ScrollArea>
              </details>
            ) : (
              <div {...stylex.props(styles.sub)}>{reasons}</div>
            ))}
          {model.hintKey && (
            <div {...stylex.props(styles.sub)}>{tr(model.hintKey, model.hintParams)}</div>
          )}
          {model.action && (
            <Flexbox horizontal align={'center'} {...stylex.props(styles.actionBar)} gap={8}>
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
