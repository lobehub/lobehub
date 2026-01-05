import { TextArea } from '@lobehub/ui';
import { FC } from 'react';

interface EditorCanvasProps {
  onChange?: (value: string) => void;
  value?: string;
}

const EditorCanvas: FC<EditorCanvasProps> = ({ value, onChange }) => {
  return (
    <TextArea
      onChange={(e) => {
        onChange?.(e.target.value);
      }}
      style={{
        cursor: 'text',
        maxHeight: '80vh',
        minHeight: '50vh',
        overflowY: 'auto',
        padding: 16,
      }}
      value={value}
      variant={'borderless'}
    />
  );
};

export default EditorCanvas;
