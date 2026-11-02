import { TextArea, type TextAreaProps as Props } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';

interface FormTextAreaProps extends Omit<Props, 'onChange'> {
  onChange?: (value: string) => void;
}

/**
 * The multi-line sibling of `FormInput`, for a field that holds a prompt or any longer text.
 *
 * Commits to the form on blur, so the form is not rewritten on every key. Enter is a new line
 * here, not a commit. The text follows the form
 * when the value changes from outside (discarding edits, resetting).
 */
const FormTextArea = memo<FormTextAreaProps>(
  ({ onBlur, onChange, value: defaultValue, ...props }) => {
    const [value, setValue] = useState(defaultValue as string);

    useEffect(() => {
      setValue(defaultValue as string);
    }, [defaultValue]);

    return (
      <TextArea
        {...props}
        value={value ?? ''}
        onBlur={(e) => {
          onChange?.(value);
          onBlur?.(e);
        }}
        onChange={(e) => {
          setValue(e.target.value);
        }}
      />
    );
  },
);

FormTextArea.displayName = 'FormTextArea';

export default FormTextArea;
