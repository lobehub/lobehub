import { Flexbox } from '@lobehub/ui';
import {
  DayjsDatePicker as DatePicker,
  type DayjsDatePickerProps as DatePickerProps,
} from '@lobehub/ui';
import { type Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

interface ApiKeyDatePickerProps extends Omit<
  DatePickerProps,
  'defaultValue' | 'onChange' | 'renderExtraFooter' | 'value'
> {
  defaultValue?: Dayjs | null;
  onChange?: (date: Dayjs | null) => void;
  /**
   * The "never expires" footer clears the date. Hide it where "never" is
   * already a sibling choice (the create form's preset select), so the picker
   * only ever answers "which date".
   */
  showNeverExpiresFooter?: boolean;
  value?: Dayjs | null;
}

const ApiKeyDatePicker: FC<ApiKeyDatePickerProps> = ({
  value,
  defaultValue,
  onChange,
  showNeverExpiresFooter = true,
  ...props
}) => {
  const { t } = useTranslation('auth');

  const handleOnChange = (date: Dayjs | null) => {
    // If a date is selected, set it to 23:59:59 of that day
    const submitData = date ? date.hour(23).minute(59).second(59).millisecond(999) : null;

    onChange?.(submitData);
  };

  return (
    <DatePicker
      defaultValue={defaultValue ?? null}
      format="YYYY-MM-DD"
      key={value?.valueOf() || 'EMPTY'}
      value={value}
      {...props}
      minDate={dayjs()}
      placeholder={t('apikey.form.fields.expiresAt.placeholder')}
      renderExtraFooter={() =>
        showNeverExpiresFooter && (
          <Flexbox horizontal justify={'center'}>
            <a
              role="button"
              style={{ cursor: 'pointer' }}
              tabIndex={0}
              onClick={() => handleOnChange(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleOnChange(null);
                }
              }}
            >
              {t('apikey.display.neverExpires')}
            </a>
          </Flexbox>
        )
      }
      onChange={handleOnChange}
    />
  );
};

export default ApiKeyDatePicker;
