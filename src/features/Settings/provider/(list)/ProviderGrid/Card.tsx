import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { ProviderCombine, ProviderIcon } from '@lobehub/icons';
import { Flexbox } from '@lobehub/ui';
import { Avatar, Skeleton, Tag, Text } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { BrandingProviderCard } from '@/business/client/features/BrandingProviderCard';
import { useIsDark } from '@/hooks/useIsDark';
import { type AiProviderListItem } from '@/types/aiProvider';

import EnableSwitch from './EnableSwitch';
import { styles } from './style';

const isCodingPlanProvider = (id: string) => id.endsWith('codingplan');

/**
 * ChatGPT is an OpenAI subscription, so its icon config points at the OpenAI
 * mark — ProviderCombine renders the OpenAI wordmark and the card reads as a
 * duplicate of the OpenAI one right beside it. Name these providers after the
 * plan instead, the way the detail page header does.
 */
const sharesVendorMark = (id: string) => id === 'chatgpt';

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
          <Skeleton />
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
                  <Flexbox horizontal align={'center'} gap={8}>
                    {sharesVendorMark(id) ? (
                      <Flexbox horizontal align={'center'} gap={12}>
                        <ProviderIcon
                          provider={id}
                          size={24}
                          style={{ borderRadius: 6 }}
                          type={'avatar'}
                        />
                        <Text style={{ fontSize: 16, fontWeight: 'bold' }}>{name || id}</Text>
                      </Flexbox>
                    ) : (
                      <ProviderCombine
                        provider={id}
                        size={24}
                        style={{ color: cssVar.colorText }}
                        title={name}
                      />
                    )}
                    {isCodingPlanProvider(id) && <Tag color={'geekblue'}>{'Coding Plan'}</Tag>}
                  </Flexbox>
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
                {source === 'custom'
                  ? description
                  : description && t(`${id}.description`, { defaultValue: description })}
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
