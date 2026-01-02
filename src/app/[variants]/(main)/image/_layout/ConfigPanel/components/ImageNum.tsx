'use client';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { ActionIcon, Flexbox, InputNumber } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { Check, Plus, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';

const DEFAULT_IMAGE_NUM_MAX = ENABLE_BUSINESS_FEATURES ? 8 : 50;

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionButton: css`
    flex-shrink: 0;
  `,

  button: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    min-width: 40px;
    height: 32px;
    padding-block: 0;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius}px;

    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};

    transition: all 0.2s ease;

    &:hover {
      border-color: ${cssVar.colorPrimary};
      background: ${cssVar.colorBgTextHover};
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;

      &:hover {
        border-color: ${cssVar.colorBorder};
        background: ${cssVar.colorBgContainer};
      }
    }
  `,

  cancelButton: css`
    border-color: ${cssVar.colorBorder};
    color: ${cssVar.colorTextTertiary};

    &:hover {
      border-color: ${cssVar.colorBorderSecondary};
      color: ${cssVar.colorText};
      background: ${cssVar.colorBgTextHover};
    }
  `,

  confirmButton: css`
    border-color: ${cssVar.colorSuccess};
    color: ${cssVar.colorSuccess};

    &:hover {
      border-color: ${cssVar.colorSuccessHover};
      color: ${cssVar.colorSuccessHover};
      background: ${cssVar.colorSuccessBg};
    }
  `,

  container: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,

  editContainer: css`
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
  `,

  input: css`
    flex: 1;
    min-width: 80px;

    .ant-input {
      font-weight: 500;
      text-align: center;
    }
  `,

  selectedButton: css`
    border-color: ${cssVar.colorPrimary};
    color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBg};

    &:hover {
      border-color: ${cssVar.colorPrimary};
      color: ${cssVar.colorPrimary};
      background: ${cssVar.colorPrimaryBgHover};
    }
  `,
}));

interface ImageNumSelectorProps {
  disabled?: boolean;
  max?: number;
  min?: number;
  presetCounts?: number[];
}

const ImageNum = memo<ImageNumSelectorProps>(
  ({ presetCounts = [1, 2, 4, 8], min = 1, max = DEFAULT_IMAGE_NUM_MAX, disabled = false }) => {
    const imageNum = useImageStore(imageGenerationConfigSelectors.imageNum);
    const setImageNum = useImageStore((s) => s.setImageNum);
    const [isEditing, setIsEditing] = useState(false);
    const [customCount, setCustomCount] = useState<number | null>(null);
    const customCountRef = useRef<number | null>(null);
    const inputRef = useRef<any>(null);

    const isCustomValue = !presetCounts.includes(imageNum);

    // 处理预设按钮点击
    const handlePresetClick = useCallback(
      (count: number) => {
        if (disabled) return;
        setImageNum(count);
      },
      [disabled, setImageNum],
    );

    // 进入编辑模式
    const handleEditStart = useCallback(() => {
      if (disabled) return;
      setCustomCount(imageNum);
      customCountRef.current = imageNum;
      setIsEditing(true);
    }, [disabled, imageNum]);

    // 确认自定义输入
    const handleCustomConfirm = useCallback(() => {
      let count = customCountRef.current;

      // 如果解析失败或输入为空，使用当前值
      if (count === null) {
        setIsEditing(false);
        return;
      }

      // 智能处理超出范围的值 (作为二次保险)
      if (count > max) {
        count = max;
      } else if (count < min) {
        count = min;
      }

      setImageNum(count);
      setIsEditing(false);
      setCustomCount(null);
    }, [min, max, setImageNum]);

    const handleCustomCancel = useCallback(() => {
      setIsEditing(false);
      setCustomCount(null);
    }, []);

    // 处理输入变化
    const handleInputChange = useCallback((value: number | string | null) => {
      console.log('handleInputChange', value);

      if (value === null) {
        setCustomCount(null);
        customCountRef.current = null;
        return;
      }

      const num = parseInt(String(value), 10);

      if (!isNaN(num)) {
        setCustomCount(num);
        customCountRef.current = num;
      }
    }, []);

    // 自动聚焦和选择输入框内容
    useEffect(() => {
      if (isEditing) {
        // 延迟聚焦以确保 input 已渲染
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
          }
        }, 100);
      }
    }, [isEditing]);

    // 验证输入是否有效
    const isValidInput = useCallback(() => {
      return customCount !== null;
    }, [customCount]);

    if (isEditing) {
      return (
        <div className={styles.editContainer}>
          <InputNumber
            className={styles.input}
            max={max}
            min={min}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                handleCustomCancel();
              }
            }}
            onPressEnter={handleCustomConfirm}
            placeholder={`${min}-${max}`}
            ref={inputRef}
            size="small"
            value={customCount}
          />
          <ActionIcon
            className={cx(styles.actionButton, styles.confirmButton)}
            disabled={!isValidInput()}
            icon={Check}
            onClick={handleCustomConfirm}
            size="small"
          />
          <ActionIcon
            className={cx(styles.actionButton, styles.cancelButton)}
            icon={X}
            onClick={handleCustomCancel}
            size="small"
          />
        </div>
      );
    }

    return (
      <Flexbox className={styles.container} horizontal>
        {presetCounts.map((count) => (
          <button
            className={cx(styles.button, imageNum === count && styles.selectedButton)}
            disabled={disabled}
            key={count}
            onClick={() => handlePresetClick(count)}
            type="button"
          >
            {count}
          </button>
        ))}

        {isCustomValue ? (
          <button
            className={cx(styles.button, styles.selectedButton)}
            disabled={disabled}
            onClick={handleEditStart}
            type="button"
          >
            {imageNum}
          </button>
        ) : (
          <button
            className={styles.button}
            disabled={disabled}
            onClick={handleEditStart}
            type="button"
          >
            <Plus size={16} />
          </button>
        )}
      </Flexbox>
    );
  },
);

ImageNum.displayName = 'ImageCountSelector';

export default ImageNum;
