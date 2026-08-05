import type { WorkVersionItem } from '@lobechat/types';
import { Center, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { formatTaskItemDate } from '@/features/AgentTasks/features/formatTaskItemDate';
import { useClientDataSWR } from '@/libs/swr';
import { workKeys } from '@/libs/swr/keys';
import { workService } from '@/services/work';
import { computeWorkVersionCostDeltas, formatWorkVersionCost } from '@/utils/workVersionCost';

const styles = createStaticStyles(({ css, cssVar }) => ({
  context: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  error: css`
    padding-block: 8px;
    padding-inline: 36px 8px;
    color: ${cssVar.colorError};
  `,
  versionCost: css`
    color: ${cssVar.colorTextTertiary};
  `,
  versionList: css`
    margin-inline-start: 34px;
    padding-block: 6px 10px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  versionRow: css`
    padding-block: 6px;
    font-size: 12px;
  `,
  versionTitle: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

const VersionList = memo<{ workId: string }>(({ workId }) => {
  const { i18n, t } = useTranslation(['chat', 'common']);
  const {
    data = [],
    error,
    isLoading,
  } = useClientDataSWR<WorkVersionItem[]>(
    workKeys.versions(workId),
    () => workService.listVersions(workId),
    {
      fallbackData: [],
      revalidateOnFocus: false,
    },
  );

  if (isLoading) {
    return (
      <Center height={56}>
        <NeuralNetworkLoading size={18} />
      </Center>
    );
  }

  if (error) {
    return <Text className={styles.error}>{t('workingPanel.works.versionError')}</Text>;
  }

  if (data.length === 0) {
    return (
      <Flexbox className={styles.versionList}>
        <Text type={'secondary'}>{t('workingPanel.works.emptyVersions')}</Text>
      </Flexbox>
    );
  }

  // cumulativeCost is a per-operation running snapshot; diff it so each row
  // shows the version's own spend and the rows visibly sum to the card total.
  const costDeltas = computeWorkVersionCostDeltas(data);

  return (
    <Flexbox className={styles.versionList}>
      {data.map((version) => {
        const cost = formatWorkVersionCost(costDeltas.get(version.id));
        const time = formatTaskItemDate(version.createdAt, {
          formatOtherYear: t('time.formatOtherYear', { ns: 'common' }),
          formatThisYear: t('time.formatThisYear', { ns: 'common' }),
          locale: i18n.language,
        });

        return (
          <Flexbox className={styles.versionRow} gap={4} key={version.id}>
            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
                <Text code fontSize={12}>
                  v{version.version}
                </Text>
                <Text ellipsis className={styles.versionTitle}>
                  {t(`workingPanel.works.changeType.${version.changeType}` as never)}
                </Text>
              </Flexbox>
              <Flexbox horizontal align={'center'} gap={8} style={{ flexShrink: 0 }}>
                {cost && (
                  <Text
                    code
                    className={styles.versionCost}
                    fontSize={12}
                    title={t('workingPanel.works.versionCost', { cost })}
                  >
                    {cost}
                  </Text>
                )}
                {time && (
                  <Text className={styles.context} type={'secondary'}>
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
