import { Input, type InputProps as Props } from '@lobehub/ui/base-ui';
import { memo, useEffect, useRef, useState } from 'react';

import { useIMECompositionEvent } from '@/hooks/useIMECompositionEvent';

interface FormInputProps extends Omit<Props, 'onChange'> {
  onChange?: (value: string) => void;
}

const FormInput = memo<FormInputProps>(({ onChange, value: defaultValue, ...props }) => {
  const ref = useRef<HTMLInputElement>(null);
  const { compositionProps, isComposingRef } = useIMECompositionEvent();

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
      {...compositionProps}
      onPressEnter={() => {
        if (isComposingRef.current) return;
        onChange?.(value);
      }}
      {...props}
      value={value}
    />
  );
});

FormInput.displayName = 'FormInput';

export default FormInput;
