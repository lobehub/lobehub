'use client';

import { Button, Icon } from '@lobehub/ui';
import { Dropdown } from 'antd';
import { createStyles } from 'antd-style';
import { ChevronDownIcon, SquareArrowOutUpRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'nextjs-toploader/app';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isDeprecatedEdition, isDesktop } from '@/const/version';

import { useDetailContext } from '../../DetailProvider';

const useStyles = createStyles(({ css }) => ({
  button: css`
    button {
      width: 100%;
    }
  `,
}));

const ProviderConfig = memo(() => {
  const { styles } = useStyles();
  const { t } = useTranslation('discover');
  const { url, modelsUrl, identifier } = useDetailContext();
  const router = useRouter();
  const openSettings = async () => {
    const searchParams = isDeprecatedEdition
      ? { active: 'llm' }
      : { active: 'provider', provider: identifier };
    const tab = isDeprecatedEdition ? 'llm' : 'provider';

    if (isDesktop) {
      const { dispatch } = await import('@lobechat/electron-client-ipc');
      await dispatch('openSettingsWindow', {
        searchParams,
        tab,
      });
      return;
    }

    router.push(
      isDeprecatedEdition
        ? '/settings?active=llm'
        : `/settings?active=provider&provider=${identifier}`,
    );
  };

  const icon = <Icon icon={SquareArrowOutUpRight} size={16} />;

  const items = [
    url && {
      icon,
      key: 'officialSite',
      label: (
        <Link href={url} target={'_blank'}>
          {t('providers.officialSite')}
        </Link>
      ),
    },
    modelsUrl && {
      icon,
      key: 'modelSite',
      label: (
        <Link href={modelsUrl} target={'_blank'}>
          {t('providers.modelSite')}
        </Link>
      ),
    },
  ].filter(Boolean) as any;

  if (!items || items?.length === 0)
    return (
      <Button block size={'large'} style={{ flex: 1 }} type={'primary'}>
        {t('providers.config')}
      </Button>
    );

  return (
    <Dropdown.Button
      className={styles.button}
      icon={<Icon icon={ChevronDownIcon} />}
      menu={{ items }}
      onClick={openSettings}
      overlayStyle={{ minWidth: 267 }}
      size={'large'}
      style={{ flex: 1, width: 'unset' }}
      type={'primary'}
    >
      {t('providers.config')}
    </Dropdown.Button>
  );
});

export default ProviderConfig;
