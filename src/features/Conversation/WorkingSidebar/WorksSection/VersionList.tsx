import type { WorkVersionItem } from '@lobechat/types';
import { Center, Flexbox, Spin, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatTaskItemDate } from '@/features/AgentTasks/features/formatTaskItemDate';
import { useWorkStore, workActions, workSelectors } from '@/store/work';
import { computeWorkVersionCostDeltas, formatWorkVersionCost } from '@/utils/workVersionCost';

const styles = stylex.create({
  context: { flexShrink: 0, color: cssVar.colorTextTertiary },
  error: {
    paddingBlock: '8px',
    paddingInlineStart: '36px',
    paddingInlineEnd: '8px',
    color: cssVar.colorError,
  },
  versionCost: { color: cssVar.colorTextTertiary },
  versionList: {
    marginInlineStart: '34px',
    paddingBlockStart: '6px',
    paddingBlockEnd: '10px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  versionRow: { paddingBlock: '6px', fontSize: '12px' },
  versionTitle: { color: cssVar.colorTextSecondary },
});

const EMPTY_VERSIONS: WorkVersionItem[] = [];

const VersionList = memo<{ workId: string }>(({ workId }) => {
  const { i18n, t } = useTranslation(['chat', 'common']);
  const params = useMemo(() => ({ workId }), [workId]);
  const { error, isHydrated } = workActions.useFetchWorkVersions(params, {
    revalidateOnFocus: false,
  });
  // `undefined` while nothing is painted yet; the stored timeline paints first.
  const stored = useWorkStore(workSelectors.workVersions(workId));
  const data = stored ?? EMPTY_VERSIONS;

  // Before the stored copy is read, paint nothing rather than a spinner.
  if (stored === undefined && !error && !isHydrated) return null;

  if (stored === undefined && !error) {
    return (
      <Center height={56}>
        <Spin size="small" />
      </Center>
    );
  }

  // A failed refresh keeps the settled timeline on screen.
  if (stored === undefined && error) {
    return (
      <Text className={stylex.props(styles.error).className}>
        {t('workingPanel.works.versionError')}
      </Text>
    );
  }

  if (data.length === 0) {
    return (
      <Flexbox className={stylex.props(styles.versionList).className}>
        <Text type={'secondary'}>{t('workingPanel.works.emptyVersions')}</Text>
      </Flexbox>
    );
  }

  // cumulativeCost is a per-operation running snapshot; diff it so each row
  // shows the version's own spend and the rows visibly sum to the card total.
  const costDeltas = computeWorkVersionCostDeltas(data);

  return (
    <Flexbox className={stylex.props(styles.versionList).className}>
      {data.map((version) => {
        const cost = formatWorkVersionCost(costDeltas.get(version.id));
        const time = formatTaskItemDate(version.createdAt, {
          formatOtherYear: t('time.formatOtherYear', { ns: 'common' }),
          formatThisYear: t('time.formatThisYear', { ns: 'common' }),
          locale: i18n.language,
        });

        return (
          <Flexbox className={stylex.props(styles.versionRow).className} gap={4} key={version.id}>
            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
                <Text code fontSize={12}>
                  v{version.version}
                </Text>
                <Text ellipsis className={stylex.props(styles.versionTitle).className}>
                  {t(`workingPanel.works.changeType.${version.changeType}` as never)}
                </Text>
              </Flexbox>
              <Flexbox horizontal align={'center'} gap={8} style={{ flexShrink: 0 }}>
                {cost && (
                  <Text
                    code
                    className={stylex.props(styles.versionCost).className}
                    fontSize={12}
                    title={t('workingPanel.works.versionCost', { cost })}
                  >
                    {cost}
                  </Text>
                )}
                {time && (
                  <Text className={stylex.props(styles.context).className} type={'secondary'}>
                    {time}
                  </Text>
                )}
              </Flexbox>
            </Flexbox>
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

VersionList.displayName = 'VersionList';

export default VersionList;
