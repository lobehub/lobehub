import { type InputProps as Props } from '@lobehub/ui';
import { Input } from '@lobehub/ui';
import { type InputRef } from 'antd/es/input/Input';
import { memo, useEffect, useRef, useState } from 'react';

interface FormInputProps extends Omit<Props, 'onChange'> {
  onChange?: (value: string) => void;
}

const FormInput = memo<FormInputProps>(({ onChange, value: defaultValue, ...props }) => {
  const ref = useRef<InputRef>(null);
  const isChineseInput = useRef(false);

  const [value, setValue] = useState(defaultValue as string);

  useEffect(() => {
    setValue(defaultValue as string);
  }, [defaultValue]);

  return (
    <Input
      ref={ref}
      onBlur={() => {
        onChange?.(value);
      }}
      onChange={(e) => {
        setValue(e.target.value);
      }}
      onCompositionEnd={() => {
        isChineseInput.current = false;
      }}
      onCompositionStart={() => {
        isChineseInput.current = true;
      }}
      onPressEnter={() => {
        if (isChineseInput.current) return;
        onChange?.(value);
      }}
      {...props}
      value={value}
    />
  );
});

FormInput.displayName = 'FormInput';

export default FormInput;
