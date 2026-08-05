'use client';

import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { FileQuestionIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Resolved not-found for a memory detail panel: the fetch succeeded but the item
 * is gone (deleted elsewhere). Distinct from a fetch *error* — which
 * `AsyncBoundary` renders via `AsyncError` with a Reload — so a deleted item
 * never masquerades as a transient failure (and vice-versa).
 */
const DetailNotFound = memo(() => {
  const { t } = useTranslation('memory');

  return (
    <Center flex={1} gap={12} padding={48} width={'100%'}>
      <Icon icon={FileQuestionIcon} size={32} style={{ color: cssVar.colorTextTertiary }} />
      <Flexbox align={'center'} gap={4}>
        <Text fontSize={16} weight={600}>
          {t('detail.notFound.title')}
        </Text>
        <Text
          align={'center'}
          color={cssVar.colorTextTertiary}
          fontSize={13}
          style={{ maxWidth: 320 }}
        >
          {t('detail.notFound.desc')}
        </Text>
      </Flexbox>
    </Center>
  );
});

export default DetailNotFound;
