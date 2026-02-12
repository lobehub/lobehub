import { DatePicker } from '@lobehub/ui';
import { type DatePickerProps } from 'antd';
import { Flex } from 'antd';
import { type Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

interface ApiKeyDatePickerProps extends Omit<DatePickerProps, 'onChange'> {
  onChange?: (date: Dayjs | null) => void;
}

const ApiKeyDatePicker: FC<ApiKeyDatePickerProps> = ({ value, onChange, ...props }) => {
  const { t } = useTranslation('auth');

  const handleOnChange = (date: Dayjs[] | Dayjs | null) => {
    // Handle both single date and array (for compatibility)
    const actualDate = Array.isArray(date) ? date[0] : date;
    // 如果选择了日期，设置为当天的 23:59:59
    const submitData = actualDate
      ? actualDate.hour(23).minute(59).second(59).millisecond(999)
      : null;

    onChange?.(submitData);
  };

  return (
    <DatePicker
      key={(value?.valueOf() as any) || 'EMPTY'}
      value={value as any}
      {...props}
      minDate={dayjs()}
      placeholder={t('apikey.form.fields.expiresAt.placeholder')}
      showNow={false}
      renderExtraFooter={() => (
        <Flex justify="center">
          <a onClick={() => handleOnChange(null)}>{t('apikey.display.neverExpires')}</a>
        </Flex>
      )}
      onChange={handleOnChange}
    />
  );
};

export default ApiKeyDatePicker;
