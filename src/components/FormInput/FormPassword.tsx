import { InputPassword, type InputPasswordProps as Props } from '@lobehub/ui/base-ui';
import { memo, useEffect, useRef, useState } from 'react';

import { useIMECompositionEvent } from '@/hooks/useIMECompositionEvent';

interface FormPasswordProps extends Omit<Props, 'onChange'> {
  onChange?: (value: string) => void;
}

const FormPassword = memo<FormPasswordProps>(
  ({ onBlur, onChange, value: defaultValue, ...props }) => {
    const ref = useRef<HTMLInputElement>(null);
    const { compositionProps, isComposingRef } = useIMECompositionEvent();

    const [value, setValue] = useState(defaultValue as string);

    useEffect(() => {
      setValue(defaultValue as string);
    }, [defaultValue]);

    return (
      <InputPassword
        ref={ref}
        onBlur={(e) => {
          onChange?.(value);
          onBlur?.(e);
        }}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        {...compositionProps}
        onPressEnter={() => {
          if (isComposingRef.current) return;
          onChange?.(value);
        }}
        // Secret field (API keys, tokens): suppress autofill of the saved login
        // password. Overridable by callers via {...props}.
        autoComplete="new-password"
        {...props}
        value={value ?? ''}
      />
    );
  },
);

FormPassword.displayName = 'FormPassword';

export default FormPassword;
