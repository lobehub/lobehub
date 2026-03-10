'use client';

import { ActionIcon, Input } from '@lobehub/ui';
import { type InputRef } from 'antd';
import { App } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { type Dayjs } from 'dayjs';
import dayjs from 'dayjs';
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
const styles = createStaticStyles(({ css, cssVar }) => ({
  actionButtons: css`
    display: flex;
    flex-shrink: 0;
    gap: 4px;
  `,
  container: css`
    position: relative;

    display: flex;
    gap: 8px;
    align-items: center;

    min-height: 32px;

    &:hover .edit-button {
      opacity: 1;
    }
  `,
  content: css`
    min-width: 0;
    line-height: 1.5;
    color: ${cssVar.colorText};
    word-break: break-all;
  `,
  editButton: css`
    opacity: 0;
    transition: opacity 0.2s ease;

    &.edit-button {
      opacity: 0;
    }
  `,
  editingContainer: css`
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
  `,
  inputWrapper: css`
    flex: 1;
  `,
  textareaWrapper: css`
    flex: 1;
  `,
}));

// Main component implementation
const EditableCell = memo<EditableCellProps>(
  ({ value, type, onSubmit, placeholder, disabled = false }) => {
    const { t } = useTranslation('auth');
    const { message } = App.useApp();

    // Edit state management
    const [isEditing, setIsEditing] = useState(false);

    // Ref for the Input element
    const inputRef = useRef<InputRef>(null);

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
        const inputValue = inputRef.current?.input?.value;

        if (!inputValue) {
          message.warning(t('apikey.validation.required'));
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
            <div className={styles.inputWrapper}>
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

          return (
            <ApiKeyDatePicker
              defaultValue={dateValue}
              open={true}
              onChange={handleDatePickerSubmit}
              onOpenChange={() => {
                if (isEditing) {
                  setIsEditing(false);
                }
              }}
            />
          );
        }

        default: {
          return null;
        }
      }
    };

    // Text type editing mode, showing save and cancel buttons
    if (type === 'text' && isEditing) {
      return (
        <div className={styles.editingContainer}>
          {renderEditMode()}
          <div className={styles.actionButtons}>
            <ActionIcon icon={Check} size="small" onClick={handleSubmit} />
            <ActionIcon icon={X} size="small" onClick={handleCancel} />
          </div>
        </div>
      );
    }

    // Date type editing mode, showing date picker
    if (type === 'date' && isEditing) {
      return renderEditMode();
    }

    // Display mode
    return (
      <div className={styles.container}>
        <div className={styles.content}>{formatDisplayValue(value)}</div>
        <ActionIcon
          className={cx(styles.editButton, 'edit-button')}
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
