'use client';

import { type DropdownItem, DropdownMenu, Flexbox } from '@lobehub/ui';
import { Button, ModalFooter, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronDown } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  // Joined split-button: main action + dropdown chevron, sharing a border like
  // antd's Dropdown.Button. Both <button>s are direct children because
  // DropdownMenu renders its trigger inline (Menu.Root is context-only).
  splitButton: css`
    & > button + button {
      margin-inline-start: -1px;
    }

    & > button:first-child {
      border-start-end-radius: 0;
      border-end-end-radius: 0;
    }

    & > button:last-child {
      border-start-start-radius: 0;
      border-end-start-radius: 0;
    }
  `,
}));

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
      <Flexbox horizontal className={styles.splitButton}>
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
