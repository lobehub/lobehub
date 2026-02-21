import { type TextAreaProps as Props } from '@lobehub/ui';
import { TextArea as LobeTextArea } from '@lobehub/ui';
import { type TextAreaRef } from 'antd/es/input/TextArea';
import { memo, useRef, useState } from 'react';

interface TextAreaProps extends Omit<Props, 'onChange'> {
  onChange?: (value: string) => void;
}

const TextArea = memo<TextAreaProps>(({ onChange, value: defaultValue, ...props }) => {
  const ref = useRef<TextAreaRef>(null);
  const isChineseInput = useRef(false);

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

TextArea.displayName = 'TextArea';

export default TextArea;
