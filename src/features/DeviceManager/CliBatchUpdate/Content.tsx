'use client';

import type { DeviceListItem, DeviceVisibility } from '@lobechat/types';
import {
  Block,
  Button,
  Center,
  cssVar,
  Flexbox,
  Icon,
  Snippet,
  Spin,
  Text,
  useModalContext,
} from '@lobehub/ui';
import {
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock,
  DownloadIcon,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import RingLoadingIcon from '@/components/RingLoading';
import { useDeviceList } from '@/store/device';

import ErrorDetails from '../ErrorDetails';
import type { BatchRowView } from './deriveBatchRowView';
import { type BatchRow, useCliBatchUpdate } from './useCliBatchUpdate';

/** Views that need someone at the device: run `lh update` there by hand. */
const MANUAL_VIEWS = new Set<BatchRowView>(['offline', 'unsupported']);

/** Static glyphs; only a row this batch is following animates. */
const STATUS_ICONS: Record<Exclude<BatchRowView, 'pending'>, [LucideIcon, string]> = {
  busy: [Clock, cssVar.colorWarning],
  failed: [CircleX, cssVar.colorError],
  inProgress: [Clock, cssVar.colorWarning],
  offline: [CircleSlash, cssVar.colorTextTertiary],
  ready: [DownloadIcon, cssVar.colorPrimary],
  success: [CircleCheck, cssVar.colorSuccess],
  timedOut: [CircleX, cssVar.colorError],
  unsupported: [CircleSlash, cssVar.colorTextTertiary],
  upToDate: [CircleCheck, cssVar.colorSuccess],
};

const StatusIcon = ({ view }: { view: BatchRowView }) => {
  if (view === 'pending') return <RingLoadingIcon size={14} />;
  const [icon, color] = STATUS_ICONS[view];
  return <Icon color={color} icon={icon} size={14} />;
};

/**
 * Why a row failed. A followed update reports its failure through the device's
 * live state; the restart response only carries a relay message from before.
 */
const failureReason = ({ entry, follow }: BatchRow) => {
  if (entry.outcome !== 'requested') return entry.state?.operation?.error ?? entry.message;
  return follow?.status === 'ok' ? follow.state.operation?.error : follow?.message;
};

const versionText = ({ entry, view }: BatchRow, device?: DeviceListItem) => {
  const current = entry.state?.currentVersion ?? device?.metadata?.cliVersion;
  const target = entry.operation?.targetVersion ?? entry.state?.latestVersion;
  if (view === 'success' && target) return `v${target}`;
  if (target && (view === 'ready' || view === 'pending'))
    return current ? `v${current} → v${target}` : `v${target}`;
  return current ? `v${current}` : undefined;
};

const RowItem = ({ device, row }: { device?: DeviceListItem; row: BatchRow }) => {
  const { t } = useTranslation('setting');
  const { entry, view } = row;
  const name = device?.friendlyName || device?.hostname || entry.deviceId;
  const version = versionText(row, device);
  // The status label is the readable summary; a device's raw reason is folded away.
  const details = view === 'failed' || view === 'unsupported' ? failureReason(row) : undefined;

  return (
    <Flexbox gap={2} paddingBlock={8} paddingInline={12}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Center flex={'none'} width={16}>
          <StatusIcon view={view} />
        </Center>
        <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={500}>
          {name}
        </Text>
        {version && (
          <Text fontSize={12} style={{ flex: 'none' }} type={'secondary'}>
            {version}
          </Text>
        )}
        <Text
          fontSize={12}
          style={{ flex: 'none', minWidth: 96, textAlign: 'end' }}
          type={view === 'failed' || view === 'timedOut' ? 'danger' : 'secondary'}
        >
          {t(`devices.cliBatch.status.${view}`)}
        </Text>
      </Flexbox>
      {view === 'timedOut' && (
        <Text fontSize={12} style={{ paddingInlineStart: 24 }} type={'secondary'}>
          {t('devices.cliBatch.timedOutDetail')}
        </Text>
      )}
      {details && (
        <Flexbox style={{ paddingInlineStart: 16 }}>
          <ErrorDetails details={details} />
        </Flexbox>
      )}
    </Flexbox>
  );
};

/**
 * One surface for the whole batch: the plan with every device's outcome, then
 * per-device progress in the same rows. Closing early is safe — each update
 * continues on its device.
 */
const CliBatchUpdateContent = ({ visibility }: { visibility: DeviceVisibility }) => {
  const { t } = useTranslation(['setting', 'common']);
  const { close } = useModalContext();
  const devices = new Map((useDeviceList().data ?? []).map((d) => [d.deviceId, d]));
  const batch = useCliBatchUpdate(visibility);
  const { phase, rows, summary } = batch;

  if (phase === 'checking')
    return (
      <Center gap={12} paddingBlock={48}>
        <Spin />
        <Text type={'secondary'}>{t('devices.cliBatch.checking')}</Text>
      </Center>
    );

  if (batch.planError)
    return (
      <Flexbox paddingBlock={16}>
        <AsyncError error={batch.planError} variant={'block'} onRetry={batch.retryPlan} />
      </Flexbox>
    );

  const sent = phase === 'following' || phase === 'done';
  const manual = rows.some((row) => MANUAL_VIEWS.has(row.view));
  const headline =
    rows.length === 0
      ? t('devices.cliBatch.empty')
      : sent
        ? t('devices.cliBatch.progress', { ...summary })
        : summary.ready > 0
          ? t('devices.cliBatch.plan', { count: summary.ready })
          : t('devices.cliBatch.nothingToUpdate');

  return (
    <Flexbox gap={16}>
      <Flexbox gap={4}>
        <Text weight={500}>{headline}</Text>
        {!sent && summary.ready > 0 && (
          <Text fontSize={12} type={'secondary'}>
            {t('devices.cliBatch.confirmDesc')}
          </Text>
        )}
        {phase === 'following' && (
          <Text fontSize={12} type={'secondary'}>
            {t('devices.cliBatch.closeHint')}
          </Text>
        )}
      </Flexbox>

      {batch.sendError && (
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon color={cssVar.colorError} icon={CircleX} size={14} />
          <Text fontSize={12} type={'danger'}>
            {t('devices.cliBatch.sendFailed')}
          </Text>
          <ErrorDetails details={batch.sendError} />
        </Flexbox>
      )}

      {rows.length > 0 && (
        <Block style={{ maxHeight: 'min(360px, 50vh)', overflowY: 'auto' }} variant={'outlined'}>
          {rows.map((row) => (
            <RowItem device={devices.get(row.entry.deviceId)} key={row.entry.deviceId} row={row} />
          ))}
        </Block>
      )}

      {manual && (
        <Flexbox gap={8}>
          <Text fontSize={12} type={'secondary'}>
            {t('devices.cliBatch.manualHint')}
          </Text>
          <Snippet language={'bash'}>lh update</Snippet>
        </Flexbox>
      )}

      <Flexbox horizontal gap={8} justify={'flex-end'}>
        {(sent || batch.sendError) && (
          <Button disabled={phase === 'following'} onClick={batch.recheck}>
            {t('devices.cliBatch.recheck')}
          </Button>
        )}
        {sent || summary.ready === 0 ? (
          <Button type={sent ? 'primary' : 'default'} onClick={close}>
            {t('common:close')}
          </Button>
        ) : (
          <>
            <Button disabled={phase === 'updating'} onClick={close}>
              {t('common:cancel')}
            </Button>
            <Button
              disabled={!!batch.sendError}
              loading={phase === 'updating'}
              type={'primary'}
              onClick={batch.update}
            >
              {t('devices.cliBatch.submit', { count: summary.ready })}
            </Button>
          </>
        )}
      </Flexbox>
    </Flexbox>
  );
};

export default CliBatchUpdateContent;
