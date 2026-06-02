'use client';

import { ModalFooter, useModalContext } from '@lobehub/ui/base-ui';
import { Button, Dropdown, Space } from 'antd';
import { ChevronDown } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

interface FooterProps {
  loading: boolean;
  onCreateAndStart: () => void;
  onCreateOnly: () => void;
}

const RunCreateFooter: FC<FooterProps> = ({ loading, onCreateAndStart, onCreateOnly }) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();
  return (
    <ModalFooter>
      <Button disabled={loading} onClick={close}>
        {t('common.cancel')}
      </Button>
      <Space.Compact>
        <Button loading={loading} type="primary" onClick={onCreateOnly}>
          {t('run.create.createOnly')}
        </Button>
        <Dropdown
          menu={{
            items: [
              {
                key: 'createAndStart',
                label: t('run.create.confirm'),
                onClick: onCreateAndStart,
              },
            ],
          }}
        >
          <Button icon={<ChevronDown size={14} />} loading={loading} type="primary" />
        </Dropdown>
      </Space.Compact>
    </ModalFooter>
  );
};

export default RunCreateFooter;
