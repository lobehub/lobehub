'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Trash2 } from 'lucide-react';
import { memo } from 'react';

import type { RemoveIdentityMemoryParams } from '../../types';
import { getRemoveIdentityViewModel } from './identityMemoryViewModel';
import { memoryCardStyles as styles } from './MemoryCardParts';

const localStyles = stylex.create({
  id: { fontFamily: cssVar.fontFamilyCode, fontSize: '12px', color: cssVar.colorTextQuaternary },
  reason: { fontSize: '13px', lineHeight: 1.6, color: cssVar.colorTextSecondary },
});

export interface RemovedIdentityCardProps {
  data?: RemoveIdentityMemoryParams;
}

/**
 * A deletion has nothing left to show, so the card carries the one thing that still
 * matters after the fact: why the identity was dropped.
 */
export const RemovedIdentityCard = memo<RemovedIdentityCardProps>(({ data }) => {
  const { id, isEmpty, reason } = getRemoveIdentityViewModel(data);

  if (isEmpty) return null;

  return (
    <Flexbox className={styles.container}>
      <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
        <Trash2 size={14} />
        <Flexbox flex={1}>
          <Text fontSize={13} weight={500}>
            Identity removed
          </Text>
        </Flexbox>
        {id && <span {...stylex.props(localStyles.id)}>{id}</span>}
      </Flexbox>

      {reason && (
        <Flexbox className={styles.content}>
          <div {...stylex.props(localStyles.reason)}>{reason}</div>
        </Flexbox>
      )}
    </Flexbox>
  );
});

RemovedIdentityCard.displayName = 'RemovedIdentityCard';

export default RemovedIdentityCard;
