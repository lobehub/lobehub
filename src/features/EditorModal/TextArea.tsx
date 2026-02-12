import { TextArea } from '@lobehub/ui';
import { type FC } from 'react';

interface EditorCanvasProps {
  defaultValue?: string;
  onChange?: (value: string) => void;
  value?: string;
}

const EditorCanvas: FC<EditorCanvasProps> = ({ defaultValue, value, onChange }) => {
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
      }}
      onChange={(e) => {
        onChange?.(e.target.value);
      }}
    />
  );
};

export default EditorCanvas;
