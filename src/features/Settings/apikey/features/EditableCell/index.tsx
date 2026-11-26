'use client';

import { ActionIcon, Input, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { type Dayjs } from 'dayjs';
import { Check, Edit, X } from 'lucide-react';
import React, { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ApiKeyDatePicker from '../ApiKeyDatePicker';

// Content type definition
export type ContentType = 'text' | 'date';

// Component Props interface definition
export interface EditableCellProps {
  /** Whether editing is disabled */
  disabled?: boolean;
  /** Submit callback function */
  onSubmit: (value: string | Date | null) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Content type */
  type: ContentType;
  /** Value retrieved from the database; regardless of type, it is stored as a string */
  value: string | null;
}

// Style definitions
const styles = stylex.create({
  actionButtons: {
    display: 'flex',
    flexShrink: 0,
    gap: '4px',
  },
  container: {
    position: 'relative',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    minHeight: '32px',
  },
  content: {
    minWidth: 0,
    lineHeight: 1.5,
    color: cssVar.colorText,
    wordBreak: 'break-all',
  },
  editButton: {
    opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 },
    transition: 'opacity 0.2s ease',
  },
  editingContainer: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    width: '100%',
  },
  inputWrapper: {
    flex: '1',
  },
});

// Main component implementation
const EditableCell = memo<EditableCellProps>(
  ({ value, type, onSubmit, placeholder, disabled = false }) => {
    const { t } = useTranslation('auth');

    // Edit state management
    const [isEditing, setIsEditing] = useState(false);

    // Ref for the Input element
    const inputRef = useRef<HTMLInputElement>(null);

    // Format display value
    const formatDisplayValue = (val: string | null) => {
      if (type === 'date' && val) {
        const date = dayjs(val);

        return date.isValid() ? date.format('YYYY-MM-DD') : val || placeholder || '';
      }

      return val || placeholder || '';
    };

    // Start editing
    const handleEdit = () => {
      if (disabled) return;

      setIsEditing(true);
    };

    // Submit edit
    const handleSubmit = () => {
      if (type === 'text') {
        const inputValue = inputRef.current?.value;

        if (!inputValue) {
          toast.warning(t('apikey.validation.required'));
          return;
        }

        onSubmit(inputValue);
      }

      setIsEditing(false);
    };

    // Cancel edit
    const handleCancel = () => {
      setIsEditing(false);
    };

    // Keyboard event handler for the input component
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    };

    // Date picker submit handler
    const handleDatePickerSubmit = (date: Dayjs | null) => {
      onSubmit(date && dayjs(date).toISOString());

      setIsEditing(false);
    };

    // Render edit mode
    const renderEditMode = () => {
      switch (type) {
        case 'text': {
          return (
            <div {...stylex.props(styles.inputWrapper)}>
              <Input
                autoFocus
                defaultValue={value as string}
                placeholder={placeholder}
                ref={inputRef}
                onKeyDown={handleKeyDown}
              />
            </div>
          );
        }

        case 'date': {
          const dateValue = value && dayjs(value).isValid() ? dayjs(value) : null;

          return <ApiKeyDatePicker defaultValue={dateValue} onChange={handleDatePickerSubmit} />;
        }

        default: {
          return null;
        }
      }
    };

    // Text type editing mode, showing save and cancel buttons
    if (type === 'text' && isEditing) {
      return (
        <div {...stylex.props(styles.editingContainer)}>
          {renderEditMode()}
          <div {...stylex.props(styles.actionButtons)}>
            <ActionIcon icon={Check} size="small" onClick={handleSubmit} />
            <ActionIcon icon={X} size="small" onClick={handleCancel} />
          </div>
        </div>
      );
    }

    // Date type editing mode, showing date picker
    if (type === 'date' && isEditing) {
      return (
        <div {...stylex.props(styles.editingContainer)}>
          {renderEditMode()}
          <ActionIcon icon={X} size="small" onClick={handleCancel} />
        </div>
      );
    }

    // Display mode
    return (
      <div {...stylex.props(styles.container, stylex.defaultMarker())}>
        <div {...stylex.props(styles.content)}>{formatDisplayValue(value)}</div>
        <ActionIcon
          className={stylex.props(styles.editButton).className}
          icon={Edit}
          size="small"
          onClick={handleEdit}
        />
      </div>
    );
  },
);

EditableCell.displayName = 'EditableCell';

export default EditableCell;
