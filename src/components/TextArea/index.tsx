import { type TextAreaProps as Props } from '@lobehub/ui';
import { TextArea as LobeTextArea } from '@lobehub/ui';
import { type TextAreaRef } from 'antd/es/input/TextArea';
import { memo, useRef, useState } from 'react';

import { useIMECompositionEvent } from '@/hooks/useIMECompositionEvent';

interface TextAreaProps extends Omit<Props, 'onChange'> {
  onChange?: (value: string) => void;
}

const TextArea = memo<TextAreaProps>(({ onChange, value: defaultValue, ...props }) => {
  const ref = useRef<TextAreaRef>(null);
  const { compositionProps, isComposingRef } = useIMECompositionEvent();

  const [value, setValue] = useState(defaultValue as string);

  return (
    <LobeTextArea
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

TextArea.displayName = 'TextArea';

export default TextArea;
