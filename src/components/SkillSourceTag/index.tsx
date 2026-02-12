import { type SkillSource } from '@lobechat/types';
import { Icon, Tag } from '@lobehub/ui';
import { BadgeCheck, CircleUser, Package } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface SkillSourceTagProps {
  source: SkillSource;
}

const SkillSourceTag = memo<SkillSourceTagProps>(({ source }) => {
  const { t } = useTranslation('plugin');

  switch (source) {
    case 'builtin': {
      return (
        <Tag color={'success'} icon={<Icon icon={BadgeCheck} />} size={'small'}>
          LobeHub
        </Tag>
      );
    }
    case 'market': {
      return (
        <Tag color={'processing'} icon={<Icon icon={CircleUser} />} size={'small'}>
          {t('store.communityPlugin')}
        </Tag>
      );
    }
    case 'user': {
      return (
        <Tag color={'warning'} icon={<Icon icon={Package} />} size={'small'}>
          {t('store.customPlugin')}
        </Tag>
      );
    }
  }
});

SkillSourceTag.displayName = 'SkillSourceTag';

export default SkillSourceTag;
