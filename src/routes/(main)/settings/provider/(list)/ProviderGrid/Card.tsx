import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { ProviderCombine, ProviderIcon } from '@lobehub/icons';
import { Avatar, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { BrandingProviderCard } from '@/business/client/features/BrandingProviderCard';
import { useIsDark } from '@/hooks/useIsDark';
import { type AiProviderListItem } from '@/types/aiProvider';

import EnableSwitch from './EnableSwitch';
import { styles } from './style';

interface ProviderCardProps extends AiProviderListItem {
  loading?: boolean;
  onProviderSelect: (provider: string) => void;
}
const ProviderCard = memo<ProviderCardProps>(
  ({ id, description, name, enabled, source, logo, loading, onProviderSelect }) => {
    const { t } = useTranslation('providers');
    const isDarkMode = useIsDark();

    if (loading)
      return (
        <Flexbox
          className={cx(isDarkMode ? styles.containerDark : styles.containerLight)}
          gap={24}
          padding={16}
        >
          <Skeleton active />
        </Flexbox>
      );

    if (id === BRANDING_PROVIDER) {
      return <BrandingProviderCard />;
    }

    return (
      <Flexbox className={cx(isDarkMode ? styles.containerDark : styles.containerLight)} gap={24}>
        <Flexbox gap={12} padding={16} width={'100%'}>
          <div
            style={{ cursor: 'pointer' }}
            onClick={() => {
              onProviderSelect(id);
            }}
          >
            <Flexbox gap={12} width={'100%'}>
              <Flexbox horizontal align={'center'} justify={'space-between'}>
                {source === 'builtin' ? (
                  <ProviderCombine
                    provider={id}
                    size={24}
                    style={{ color: cssVar.colorText }}
                    title={name}
                  />
                ) : (
                  <Flexbox horizontal align={'center'} gap={12}>
                    {logo ? (
                      <Avatar alt={name || id} avatar={logo} size={28} />
                    ) : (
                      <ProviderIcon
                        provider={id}
                        size={24}
                        style={{ borderRadius: 6 }}
                        type={'avatar'}
                      />
                    )}
                    <Text style={{ fontSize: 16, fontWeight: 'bold' }}>{name || id}</Text>
                  </Flexbox>
                )}
              </Flexbox>
              <Text
                className={styles.desc}
                ellipsis={{
                  rows: 2,
                }}
              >
                {source === 'custom' ? description : t(`${id}.description`)}
              </Text>
            </Flexbox>
          </div>
          <Divider style={{ margin: '4px 0' }} />
          <Flexbox horizontal justify={'space-between'}>
            <div />
            <EnableSwitch enabled={enabled} id={id} />
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);

export default ProviderCard;
