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

// 内容类型定义
export type ContentType = 'text' | 'date';

// 组件Props接口定义
export interface EditableCellProps {
  /** 是否禁用编辑 */
  disabled?: boolean;
  /** 提交回调函数 */
  onSubmit: (value: string | Date | null) => void;
  /** 占位符文本 */
  placeholder?: string;
  /** 内容类型 */
  type: ContentType;
  /** 从数据库中查出的值，不管是什么类型，存进去的都是字符串 */
  value: string | null;
}

// 样式定义
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

// 主组件实现
const EditableCell = memo<EditableCellProps>(
  ({ value, type, onSubmit, placeholder, disabled = false }) => {
    const { t } = useTranslation('auth');
    const { message } = App.useApp();

    // 编辑状态管理
    const [isEditing, setIsEditing] = useState(false);

    // 用于Input的ref
    const inputRef = useRef<InputRef>(null);

    // 格式化显示值
    const formatDisplayValue = (val: string | null) => {
      if (type === 'date' && val) {
        const date = dayjs(val);

        return date.isValid() ? date.format('YYYY-MM-DD') : val || placeholder || '';
      }

      return val || placeholder || '';
    };

    // 开始编辑
    const handleEdit = () => {
      if (disabled) return;

      setIsEditing(true);
    };

    // 提交编辑
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

    // 取消编辑
    const handleCancel = () => {
      setIsEditing(false);
    };

    // 输入框组件的键盘事件处理
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    };

    // 日期选择器提交
    const handleDatePickerSubmit = (date: Dayjs | null) => {
      onSubmit(date && dayjs(date).toISOString());

      setIsEditing(false);
    };

    // 渲染编辑模式
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

    // 文本类型的编辑模式，展示保存和取消按钮
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

    // 日期类型的编辑模式，展示日期选择器
    if (type === 'date' && isEditing) {
      return renderEditMode();
    }

    // 展示模式
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
