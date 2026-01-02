import { Button, Icon, Tag, Typography } from '@lobehub/ui';
import { Divider } from 'antd';
import { Github, Settings, Share2 } from 'lucide-react';
import Image from 'next/image';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AGENTS_INDEX_GITHUB, imageUrl } from '@/const/url';

const Inner = memo(() => {
  const { t } = useTranslation('discover');
  return (
    <Typography fontSize={14} headerMultiple={0.5} marginMultiple={0.4}>
      <Image
        alt={'banner'}
        height={602}
        src={imageUrl('banner_market_modal.webp')}
        style={{ height: 'auto', marginBottom: 24, width: '100%' }}
        width={1602}
      />
      <h3>
        <Tag color={'cyan'}>{t('createGuide.func1.tag')}</Tag>
        <span>{t('createGuide.func1.title')}</span>
      </h3>
      <p>
        <kbd>
          <Icon icon={Settings} />
        </kbd>
        {t('createGuide.func1.desc1')}
        <br />
        <kbd>
          <Icon icon={Share2} />
        </kbd>
        {t('createGuide.func1.desc2')}
      </p>
      <Divider />
      <h3>
        <Tag color={'cyan'}>{t('createGuide.func2.tag')}</Tag>
        <span>{t('createGuide.func2.title')}</span>
      </h3>
      <p>{t('createGuide.func2.desc')}</p>
      <br />
      <Button
        icon={Github}
        onClick={() => window.open(AGENTS_INDEX_GITHUB, '__blank')}
        type={'primary'}
      >
        {t('createGuide.func2.button')}
      </Button>
    </Typography>
  );
});

export default Inner;
