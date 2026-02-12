'use client';

import { Button, Flexbox, Modal } from '@lobehub/ui';
import { ArrowUpRightIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChangelogService } from '@/server/services/changelog';

import ChangelogContent from './ChangelogContent';

interface ChangelogModalProps {
  onClose: () => void;
  open: boolean;
  shouldLoad: boolean;
}

const ChangelogModal = memo<ChangelogModalProps>(({ open, onClose, shouldLoad }) => {
  const { t } = useTranslation('common');
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (shouldLoad && data.length === 0) {
      setIsLoading(true);
      const changelogService = new ChangelogService();
      changelogService
        .getChangelogIndex()
        .then((result) => {
          setData(result);
        })
        .catch((error) => {
          console.error('Failed to load changelog:', error);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [shouldLoad, data.length]);

  return open ? (
    <Modal
      maskClosable
      footer={null}
      open={true}
      width={800}
      styles={{
        body: {
          maxHeight: '70vh',
          overflowY: 'auto',
        },
      }}
      title={
        <Flexbox align={'center'} gap={8}>
          <Button
            icon={<ArrowUpRightIcon size={16} />}
            iconPlacement="end"
            type="text"
            onClick={onClose}
          >
            {t('changelog')}
          </Button>
        </Flexbox>
      }
      onCancel={onClose}
    >
      <Flexbox gap={16} padding={16} style={{ width: '100%' }}>
        {isLoading || data.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center' }}>{t('loading')}</div>
        ) : (
          <ChangelogContent data={data} />
        )}
      </Flexbox>
    </Modal>
  ) : null;
});

ChangelogModal.displayName = 'ChangelogModal';

export default ChangelogModal;
