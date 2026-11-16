import { Icon, Tag, Tooltip } from '@lobehub/ui';
import { LockIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Marks the caller's private connector in a private agent's skill menu. */
const PrivateConnectorTag = () => {
  const { t } = useTranslation('setting');

  return (
    <Tooltip placement={'top'} title={t('tools.privateConnector.tooltip')}>
      <Tag icon={<Icon icon={LockIcon} />} size={'small'}>
        {t('tools.privateConnector.tag')}
      </Tag>
    </Tooltip>
  );
};

export default PrivateConnectorTag;
