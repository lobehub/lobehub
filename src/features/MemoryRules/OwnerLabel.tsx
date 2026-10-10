'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import { Avatar, cssVar, Flexbox } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import type { OwnerSection } from './labels';
import { styles } from './styles';

interface OwnerLabelProps {
  count: number;
  owner: OwnerSection['owner'];
}

/**
 * One option of the switcher above the sheet: "My rules", or the agent's avatar and name, each
 * with how many are in force.
 */
const OwnerLabel = ({ count, owner }: OwnerLabelProps) => {
  const { t } = useTranslation('memory');

  return (
    <Flexbox horizontal align={'center'} gap={6}>
      {/* Decorative: the name follows, so screen readers should not hear it twice. */}
      {owner.kind === 'agent' && (
        <span aria-hidden style={{ display: 'inline-flex' }}>
          <Avatar
            avatar={owner.agent.avatar || DEFAULT_AVATAR}
            background={owner.agent.backgroundColor || cssVar.colorBgContainer}
            shape={'circle'}
            size={16}
          />
        </span>
      )}
      <span>
        {owner.kind === 'mine'
          ? t('rules.owner.mine')
          : owner.agent.title || t('rules.owner.untitledAgent')}
      </span>
      <span className={styles.ownerCount}>{count}</span>
    </Flexbox>
  );
};

export default OwnerLabel;
