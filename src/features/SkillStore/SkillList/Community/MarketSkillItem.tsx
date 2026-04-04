'use client';

import { ActionIcon, Avatar, Block, Flexbox, Icon, Tag } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { type DiscoverSkillItem } from '@/types/discover';

import { itemStyles } from '../style';

const MarketSkillItem = memo<DiscoverSkillItem>(({ name, icon, description, identifier }) => {
  const { t } = useTranslation('plugin');
  const navigate = useNavigate();

  const link = urlJoin('/community/skill', identifier);

  const handleNavigate = () => {
    navigate(link);
  };

  return (
    <Flexbox className={itemStyles.container} gap={0}>
      <Block
        clickable
        horizontal
        align={'center'}
        gap={12}
        paddingBlock={12}
        paddingInline={12}
        style={{ cursor: 'pointer' }}
        variant={'outlined'}
        onClick={handleNavigate}
      >
        <Avatar avatar={icon || name} shape={'square'} size={40} style={{ flex: 'none' }} />
        <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
          <Flexbox horizontal align="center" gap={8}>
            <span className={itemStyles.title}>{name}</span>
            <Tag icon={<Icon icon={SkillsIcon} />} size={'small'} />
          </Flexbox>
          {description && <span className={itemStyles.description}>{description}</span>}
        </Flexbox>
        <ActionIcon icon={Plus} title={t('store.actions.install')} onClick={handleNavigate} />
      </Block>
    </Flexbox>
  );
});

MarketSkillItem.displayName = 'MarketSkillItem';

export default MarketSkillItem;
