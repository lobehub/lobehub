import { TextArea as LobeTextArea, type TextAreaProps as Props } from '@lobehub/ui';
import { memo, useRef, useState } from 'react';

import { useIMECompositionEvent } from '@/hooks/useIMECompositionEvent';

interface TextAreaProps extends Omit<Props, 'onChange'> {
  onChange?: (value: string) => void;
}

const TextArea = memo<TextAreaProps>(({ onBlur, onChange, value: defaultValue, ...props }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { compositionProps, isComposingRef } = useIMECompositionEvent();

  const [value, setValue] = useState(defaultValue as string);

  return (
    <LobeTextArea
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
      {...props}
      value={value ?? ''}
    />
  );
});

TextArea.displayName = 'TextArea';

export default TextArea;
