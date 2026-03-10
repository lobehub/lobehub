'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { DatePicker, Modal } from 'antd';
import { type RangePickerProps } from 'antd/es/date-picker';
import dayjs from 'dayjs';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  footerNote: string;
  onCancel: () => void;
  onChange: (range: [Date | null, Date | null]) => void;
  onSubmit: () => void;
  open: boolean;
  range: [Date | null, Date | null];
  submitting: boolean;
}

const DateRangeModal = memo<Props>(
  ({ footerNote, onCancel, onChange, onSubmit, open, range, submitting }) => {
    const { t } = useTranslation('memory');

    const disabledDate = useCallback<NonNullable<RangePickerProps['disabledDate']>>(
      (current) => current.isAfter(dayjs(), 'day'),
      [],
    );

    return (
      <Modal
        cancelText={t('analysis.modal.cancel')}
        okButtonProps={{ loading: submitting }}
        okText={t('analysis.modal.submit')}
        open={open}
        title={t('analysis.modal.title')}
        onCancel={onCancel}
        onOk={onSubmit}
      >
        <Flexbox gap={12}>
          <Text type={'secondary'}>{t('analysis.modal.helper')}</Text>
          <DatePicker.RangePicker
            allowClear
            disabledDate={disabledDate}
            format={'YYYY/MM/DD'}
            style={{ width: '100%' }}
            value={[range[0] ? dayjs(range[0]) : null, range[1] ? dayjs(range[1]) : null]}
            onChange={(values) =>
              onChange([values?.[0]?.toDate() ?? null, values?.[1]?.toDate() ?? null])
            }
          />
          <Text fontSize={12} type={'secondary'}>
            {footerNote}
          </Text>
        </Flexbox>
      </Modal>
    );
  },
);

DateRangeModal.displayName = 'DateRangeModal';

export default DateRangeModal;
