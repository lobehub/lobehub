'use client';

import { Flexbox, Highlighter, Icon } from '@lobehub/ui';
import { Tag, Text, Tooltip } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { BotIcon, ChevronDownIcon, ChevronRightIcon, UserIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import type { DashboardWidgetVersionItem } from '@/services/dashboard';
import { dashboardSelectors, useDashboardStore } from '@/store/dashboard';

const VERSION_STATUS_COLOR: Record<string, string | undefined> = {
  archived: undefined,
  draft: 'info',
  published: 'success',
};

const RUNTIME_LANGUAGE: Record<string, string> = {
  bash: 'bash',
  node: 'javascript',
  python: 'python',
};

const styles = createStaticStyles(({ css }) => ({
  item: css`
    padding: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  toggle: css`
    cursor: pointer;
    user-select: none;
  `,
}));

const VersionItem = memo<{ version: DashboardWidgetVersionItem }>(({ version }) => {
  const { t } = useTranslation('dashboard');
  const [showScript, setShowScript] = useState(false);

  return (
    <Flexbox className={styles.item} data-version={version.version} gap={6}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Text weight={600}>{`v${version.version}`}</Text>
        <Tag color={VERSION_STATUS_COLOR[version.status]} size={'small'}>
          {t(`version.status.${version.status}`)}
        </Tag>
        <Tag size={'small'}>{version.runtime}</Tag>
        <Tag size={'small'}>{version.outputType}</Tag>
        <Flexbox flex={1} />
        <Tooltip title={t(`version.source.${version.sourceType}`)}>
          <Icon
            color={cssVar.colorTextTertiary}
            icon={version.sourceType === 'agent' ? BotIcon : UserIcon}
            size={14}
          />
        </Tooltip>
        <Text
          fontSize={12}
          title={dayjs(version.createdAt).format('YYYY-MM-DD HH:mm:ss')}
          type={'secondary'}
        >
          {dayjs(version.createdAt).fromNow()}
        </Text>
      </Flexbox>
      {version.changeNote && <Text fontSize={12}>{version.changeNote}</Text>}
      {version.publishedAt && (
        <Text fontSize={12} type={'secondary'}>
          {t('version.publishedAt', {
            time: dayjs(version.publishedAt).format('YYYY-MM-DD HH:mm'),
          })}
        </Text>
      )}
      <Flexbox
        horizontal
        align={'center'}
        className={styles.toggle}
        gap={4}
        onClick={() => setShowScript((value) => !value)}
      >
        <Icon icon={showScript ? ChevronDownIcon : ChevronRightIcon} size={14} />
        <Text fontSize={12} type={'secondary'}>
          {t('version.script')}
        </Text>
      </Flexbox>
      {showScript && (
        <Highlighter
          language={RUNTIME_LANGUAGE[version.runtime] ?? 'plaintext'}
          style={{ maxHeight: 320, overflow: 'auto' }}
          variant={'filled'}
        >
          {version.script}
        </Highlighter>
      )}
    </Flexbox>
  );
});

VersionItem.displayName = 'DashboardVersionItem';

/** Every version of the widget, newest first, with the live one marked. */
const VersionList = memo<{ widgetId: string }>(({ widgetId }) => {
  const { t } = useTranslation('dashboard');
  const useFetchWidgetVersions = useDashboardStore((s) => s.useFetchWidgetVersions);
  const { data, error, isLoading, mutate } = useFetchWidgetVersions(widgetId);
  const versions = useDashboardStore(dashboardSelectors.widgetVersions(widgetId));

  return (
    <AsyncBoundary
      data={data}
      error={error}
      isEmpty={data?.length === 0}
      isLoading={isLoading}
      empty={
        <Text fontSize={12} type={'secondary'}>
          {t('version.empty')}
        </Text>
      }
      onRetry={() => void mutate()}
    >
      <Flexbox gap={8}>
        {versions.map((version) => (
          <VersionItem key={version.id} version={version} />
        ))}
      </Flexbox>
    </AsyncBoundary>
  );
});

VersionList.displayName = 'DashboardVersionList';

export default VersionList;
