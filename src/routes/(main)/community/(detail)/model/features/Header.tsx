'use client';

import { Flexbox, Icon, Text, useResponsive } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { DotIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ModelIcon } from '@/components/LobeIcons';
import { ModelInfoTags } from '@/components/ModelSelect';
import PublishedTime from '@/components/PublishedTime';
import ModelTypeIcon from '@/routes/(main)/community/(list)/model/features/List/ModelTypeIcon';

import { useDetailContext } from './DetailProvider';

const styles = stylex.create({
  time: { fontSize: '12px', color: cssVar.colorTextDescription },
});

const Header = memo<{ mobile?: boolean }>(({ mobile: isMobile }) => {
  const { description, identifier, releasedAt, displayName, type, abilities, contextWindowTokens } =
    useDetailContext();
  const { mobile = isMobile } = useResponsive();
  const { t } = useTranslation('models');

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'flex-start'} gap={16} width={'100%'}>
        <ModelIcon model={identifier} size={mobile ? 48 : 64} />
        <Flexbox
          flex={1}
          gap={4}
          style={{
            overflow: 'hidden',
          }}
        >
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            justify={'space-between'}
            style={{
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <Flexbox
              horizontal
              align={'center'}
              flex={1}
              gap={12}
              style={{
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <Text
                as={'h1'}
                ellipsis={{ rows: 1 }}
                style={{ fontSize: mobile ? 18 : 24, margin: 0 }}
                title={identifier}
              >
                {displayName || identifier}
              </Text>
            </Flexbox>
            <Flexbox horizontal align={'center'} gap={6}>
              {type && <ModelTypeIcon type={type} />}
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={4}>
            <span>{identifier}</span>
            <Icon icon={DotIcon} />
            <ModelInfoTags
              directionReverse
              contextWindowTokens={contextWindowTokens}
              {...abilities}
            />
            <Icon icon={DotIcon} />
            <PublishedTime
              className={stylex.props(styles.time).className}
              date={releasedAt as string}
            />
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <div
        style={{
          color: cssVar.colorTextSecondary,
        }}
      >
        {t(`${identifier}.description`, { defaultValue: description })}
      </div>
    </Flexbox>
  );
});

export default Header;
