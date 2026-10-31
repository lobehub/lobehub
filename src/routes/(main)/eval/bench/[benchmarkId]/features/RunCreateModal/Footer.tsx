'use client';

import { type DropdownItem, DropdownMenu, Flexbox } from '@lobehub/ui';
import { Button, ModalFooter, useModalContext } from '@lobehub/ui';
import { ChevronDown } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import moduleStyles from './Footer.module.css';

interface FooterProps {
  loading: boolean;
  onCreateAndStart: () => void;
  onCreateOnly: () => void;
}

const RunCreateFooter: FC<FooterProps> = ({ loading, onCreateAndStart, onCreateOnly }) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();

  const menuItems: DropdownItem[] = [
    {
      key: 'createAndStart',
      label: t('run.create.confirm'),
      onClick: onCreateAndStart,
    },
  ];

  return (
    <ModalFooter>
      <Button disabled={loading} onClick={close}>
        {t('common.cancel')}
      </Button>
      <Flexbox horizontal className={moduleStyles.splitButton}>
        <Button loading={loading} type="primary" onClick={onCreateOnly}>
          {t('run.create.createOnly')}
        </Button>
        <DropdownMenu items={menuItems}>
          <Button icon={<ChevronDown size={14} />} loading={loading} type="primary" />
        </DropdownMenu>
      </Flexbox>
    </ModalFooter>
  );
};

export default RunCreateFooter;
