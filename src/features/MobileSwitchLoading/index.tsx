import { Center, Flexbox, Icon } from '@lobehub/ui';
import { Loader2 } from 'lucide-react';
import { type DynamicOptions } from 'next/dist/shared/lib/dynamic';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';

const MobileSwitchLoading: DynamicOptions['loading'] = memo(() => {
  const { t } = useTranslation('common');
  return (
    <Flexbox height={'100%'} style={{ position: 'relative', userSelect: 'none' }} width={'100%'}>
      <Center flex={1} gap={16} width={'100%'}>
        <ProductLogo size={48} type={'combine'} />
        <Center horizontal gap={12} style={{ fontSize: 15, lineHeight: 1.5, opacity: 0.66 }}>
          <Icon spin icon={Loader2} size={16} />
          {t('layoutInitializing')}
        </Center>
      </Center>
    </Flexbox>
  );
});

export default MobileSwitchLoading;
