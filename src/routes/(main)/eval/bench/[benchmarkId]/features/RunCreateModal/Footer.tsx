'use client';

import {
  Button,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  ModalFooter,
  useModalContext,
} from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  splitMain: {
    borderEndEndRadius: 0,
    borderStartEndRadius: 0,
  },
  splitToggle: {
    marginInlineStart: '-1px',
    borderEndStartRadius: 0,
    borderStartStartRadius: 0,
  },
});

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
      <Flexbox horizontal>
        <Button
          className={stylex.props(styles.splitMain).className}
          loading={loading}
          type="primary"
          onClick={onCreateOnly}
        >
          {t('run.create.createOnly')}
        </Button>
        <DropdownMenu items={menuItems}>
          <Button
            className={stylex.props(styles.splitToggle).className}
            icon={<ChevronDown size={14} />}
            loading={loading}
            type="primary"
          />
        </DropdownMenu>
      </Flexbox>
    </ModalFooter>
  );
};

export default RunCreateFooter;
