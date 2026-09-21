'use client';

import { Block } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

import type { StandardItem } from '@/services/expertise';

const styles = createStaticStyles(({ css }) => ({
  active: css`
    border-color: ${cssVar.colorPrimaryBorder};
    background: ${cssVar.colorFillQuaternary};
  `,
  archived: css`
    opacity: 0.6;
  `,
  row: css`
    cursor: pointer;
    padding-block: 12px;
    padding-inline: 16px;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  title: css`
    text-wrap: pretty;
  `,
}));

interface StandardRowProps {
  active?: boolean;
  onSelect: () => void;
  standard: StandardItem;
}

/**
 * One verifier as the reviewer reads it: the sentence, then the only counts that exist today.
 *
 * No leading code: `P-07` is a storage detail with no meaning to the person reading the list, and
 * a column of identifiers in front of every sentence is the first thing the eye has to skip.
 */
const StandardRow = ({ active, onSelect, standard }: StandardRowProps) => {
  const { t } = useTranslation('memory');
  const isArchived = standard.status === 'retired';

  return (
    <Block
      gap={6}
      variant={'outlined'}
      className={[styles.row, active && styles.active, isArchived && styles.archived]
        .filter(Boolean)
        .join(' ')}
      onClick={onSelect}
    >
      <Text className={styles.title} weight={500}>
        {standard.title}
      </Text>
      <Text fontSize={12} type={'secondary'}>
        {t('rules.meta.rejections', { count: standard.hitCount })}
        {standard.lastHitAt &&
          ` · ${t('rules.meta.lastSeen', { time: dayjs(standard.lastHitAt).fromNow() })}`}
      </Text>
    </Block>
  );
};

export default StandardRow;
