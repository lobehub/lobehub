'use client';

import { Github, ProviderCombine } from '@lobehub/icons';
import { ActionIcon, Flexbox, stopPropagation } from '@lobehub/ui';
import { cssVar, useResponsive } from 'antd-style';
import { GlobeIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useDetailContext } from './DetailProvider';

const Header = memo<{ mobile?: boolean }>(({ mobile: isMobile }) => {
  const { t } = useTranslation('providers');
  const { identifier, url, modelsUrl, name } = useDetailContext();
  const { mobile = isMobile } = useResponsive();

  return (
    <Flexbox gap={12}>
      <Flexbox
        horizontal
        align={'flex-start'}
        gap={8}
        justify={'space-between'}
        style={{
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <Flexbox align={'flex-start'} width={'100%'}>
          <ProviderCombine provider={identifier} size={mobile ? 32 : 48} />
          <Flexbox horizontal align={'center'} gap={4}>
            {Boolean(url || modelsUrl) ? (
              <a href={url || (modelsUrl as string)} rel="noreferrer" target="_blank">
                @{name}
              </a>
            ) : (
              <span>@{name}</span>
            )}
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align={'center'}>
          {Boolean(url || modelsUrl) && (
            <a
              href={(url || modelsUrl) as string}
              rel="noreferrer"
              target="_blank"
              onClick={stopPropagation}
            >
              <ActionIcon color={cssVar.colorTextDescription} icon={GlobeIcon} />
            </a>
          )}

          <a
            rel="noreferrer"
            target="_blank"
            href={urlJoin(
              'https://github.com/lobehub/lobe-chat-agents/tree/main/locales',
              identifier as string,
            )}
            onClick={stopPropagation}
          >
            <ActionIcon fill={cssVar.colorTextDescription} icon={Github} />
          </a>
        </Flexbox>
      </Flexbox>

      <Flexbox
        horizontal
        align={'center'}
        gap={mobile ? 12 : 24}
        style={{
          color: cssVar.colorTextSecondary,
        }}
      >
        {t(`${identifier}.description`)}
      </Flexbox>
    </Flexbox>
  );
});

export default Header;
