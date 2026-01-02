'use client';

import { Github, ProviderCombine } from '@lobehub/icons';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { cssVar, useResponsive } from 'antd-style';
import { GlobeIcon } from 'lucide-react';
import Link from 'next/link';
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
        align={'flex-start'}
        gap={8}
        horizontal
        justify={'space-between'}
        style={{
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <Flexbox align={'flex-start'} width={'100%'}>
          <ProviderCombine provider={identifier} size={mobile ? 32 : 48} />
          <Flexbox align={'center'} gap={4} horizontal>
            {Boolean(url || modelsUrl) ? (
              <Link href={url || (modelsUrl as string)} target={'_blank'}>
                @{name}
              </Link>
            ) : (
              <span>@{name}</span>
            )}
          </Flexbox>
        </Flexbox>
        <Flexbox align={'center'} horizontal>
          {Boolean(url || modelsUrl) && (
            <Link
              href={(url || modelsUrl) as string}
              onClick={(e) => e.stopPropagation()}
              target={'_blank'}
            >
              <ActionIcon color={cssVar.colorTextDescription} icon={GlobeIcon} />
            </Link>
          )}

          <Link
            href={urlJoin(
              'https://github.com/lobehub/lobe-chat-agents/tree/main/locales',
              identifier as string,
            )}
            onClick={(e) => e.stopPropagation()}
            target={'_blank'}
          >
            <ActionIcon fill={cssVar.colorTextDescription} icon={Github} />
          </Link>
        </Flexbox>
      </Flexbox>

      <Flexbox
        align={'center'}
        gap={mobile ? 12 : 24}
        horizontal
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
