'use client';

import { isDesktop } from '@lobechat/const';
import { Button, Icon } from '@lobehub/ui';
import { Dropdown } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ChevronDownIcon, SquareArrowOutUpRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { useDetailContext } from '../../DetailProvider';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    button {
      width: 100%;
    }
  `,
}));

const ProviderConfig = memo(() => {
  const { t } = useTranslation('discover');
  const { url, modelsUrl, identifier } = useDetailContext();
  const navigate = useNavigate();
  const openSettings = async () => {
    if (isDesktop) {
      const { ensureElectronIpc } = await import('@/utils/electron/ipc');
      await ensureElectronIpc().windows.openSettingsWindow({
        path: `/settings/provider/${identifier}`,
      });
      return;
    }
    navigate(`/settings/provider/${identifier}`);
  };

  const icon = <Icon icon={SquareArrowOutUpRight} size={16} />;

  const items = [
    url && {
      icon,
      key: 'officialSite',
      label: (
        <Link target={'_blank'} to={url}>
          {t('providers.officialSite')}
        </Link>
      ),
    },
    modelsUrl && {
      icon,
      key: 'modelSite',
      label: (
        <Link target={'_blank'} to={modelsUrl}>
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
      overlayStyle={{ minWidth: 267 }}
      size={'large'}
      style={{ flex: 1, width: 'unset' }}
      type={'primary'}
      onClick={openSettings}
    >
      {t('providers.config')}
    </Dropdown.Button>
  );
});

export default ProviderConfig;
