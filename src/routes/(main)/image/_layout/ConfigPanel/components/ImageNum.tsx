'use client';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { ActionIcon, Flexbox, InputNumber, Segmented } from '@lobehub/ui';
import { Check, Plus, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';

const DEFAULT_IMAGE_NUM_MAX = ENABLE_BUSINESS_FEATURES ? 8 : 50;
const CUSTOM_VALUE = '__custom__';

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

    const options = useMemo(() => {
      const items = presetCounts.map((count) => ({
        label: String(count),
        value: count,
      }));

      // Add custom option or show current custom value
      if (isCustomValue) {
        items.push({
          label: String(imageNum),
          value: imageNum,
        });
      } else {
        items.push({
          label: <Plus size={16} style={{ verticalAlign: 'middle' }} />,
          value: CUSTOM_VALUE,
        } as any);
      }

      return items;
    }, [presetCounts, isCustomValue, imageNum]);

    const handleChange = useCallback(
      (value: number | string) => {
        if (disabled) return;

        if (value === CUSTOM_VALUE || (isCustomValue && value === imageNum)) {
          // Enter edit mode
          setCustomCount(imageNum);
          customCountRef.current = imageNum;
          setIsEditing(true);
        } else {
          setImageNum(value as number);
        }
      },
      [disabled, isCustomValue, imageNum, setImageNum],
    );

    const handleCustomConfirm = useCallback(() => {
      let count = customCountRef.current;

      if (count === null) {
        setIsEditing(false);
        return;
      }

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

    const handleInputChange = useCallback((value: number | string | null) => {
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

    useEffect(() => {
      if (isEditing) {
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
          }
        }, 100);
      }
    }, [isEditing]);

    const isValidInput = customCount !== null;

    if (isEditing) {
      return (
        <Flexbox horizontal gap={8} style={{ width: '100%' }}>
          <InputNumber
            max={max}
            min={min}
            placeholder={`${min}-${max}`}
            ref={inputRef}
            size="small"
            style={{ flex: 1 }}
            value={customCount}
            onChange={handleInputChange}
            onPressEnter={handleCustomConfirm}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                handleCustomCancel();
              }
            }}
          />
          <ActionIcon
            color="success"
            disabled={!isValidInput}
            icon={Check}
            size="small"
            variant="filled"
            onClick={handleCustomConfirm}
          />
          <ActionIcon icon={X} size="small" variant="filled" onClick={handleCustomCancel} />
        </Flexbox>
      );
    }

    return (
      <Segmented
        block
        disabled={disabled}
        options={options}
        style={{ width: '100%' }}
        value={isCustomValue ? imageNum : imageNum}
        variant="filled"
        onChange={handleChange}
      />
    );
  },
);

ImageNum.displayName = 'ImageCountSelector';

export default ImageNum;
