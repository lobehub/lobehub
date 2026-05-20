import { TextArea, type TextAreaProps } from '@lobehub/ui';
import { type FC } from 'react';

interface EditorCanvasProps {
  defaultValue?: string;
  onChange?: (value: string) => void;
  style?: TextAreaProps['style'];
  value?: string;
}

const EditorCanvas: FC<EditorCanvasProps> = ({ defaultValue, value, onChange, style }) => {
  return (
    <TextArea
      defaultValue={defaultValue}
      value={value}
      variant={'borderless'}
      style={{
        cursor: 'text',
        maxHeight: '80vh',
        minHeight: '50vh',
        overflowY: 'auto',
        padding: 16,
        ...style,
      }}
      onChange={(e) => {
        onChange?.(e.target.value);
      }}
    />
  );
};

export default EditorCanvas;
