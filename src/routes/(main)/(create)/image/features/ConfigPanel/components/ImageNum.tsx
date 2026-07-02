'use client';

import { ActionIcon, Flexbox, InputNumber } from '@lobehub/ui';
import { Tabs, type TabsItem } from '@lobehub/ui/base-ui';
import { Check, Plus, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

const CUSTOM_VALUE = '__custom__';

interface ImageNumSelectorProps {
  disabled?: boolean;
  max?: number;
  min?: number;
  presetCounts?: number[];
}

const ImageNum = memo<ImageNumSelectorProps>(
  ({ presetCounts = [1, 2, 4, 8], min = 1, max, disabled = false }) => {
    const imageNum = useImageStore(imageGenerationConfigSelectors.imageNum);
    const setImageNum = useImageStore((s) => s.setImageNum);
    const enableBusinessFeatures = useServerConfigStore(
      serverConfigSelectors.enableBusinessFeatures,
    );
    const resolvedMax = max ?? (enableBusinessFeatures ? 8 : 50);
    const [isEditing, setIsEditing] = useState(false);
    const [customCount, setCustomCount] = useState<number | null>(null);
    const customCountRef = useRef<number | null>(null);
    const inputRef = useRef<any>(null);

    const isCustomValue = !presetCounts.includes(imageNum);

    const options = useMemo<TabsItem[]>(() => {
      const items: TabsItem[] = presetCounts.map((count) => ({
        key: String(count),
        label: String(count),
      }));

      if (isCustomValue) {
        items.push({
          key: String(imageNum),
          label: String(imageNum),
        });
      } else {
        items.push({
          key: CUSTOM_VALUE,
          label: <Plus size={16} style={{ verticalAlign: 'middle' }} />,
        });
      }

      return items;
    }, [presetCounts, isCustomValue, imageNum]);

    const handleChange = useCallback(
      (key: string) => {
        if (disabled) return;

        if (key === CUSTOM_VALUE || (isCustomValue && Number(key) === imageNum)) {
          setCustomCount(imageNum);
          customCountRef.current = imageNum;
          setIsEditing(true);
        } else {
          setImageNum(Number(key));
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

      if (count > resolvedMax) {
        count = resolvedMax;
      } else if (count < min) {
        count = min;
      }

      setImageNum(count);
      setIsEditing(false);
      setCustomCount(null);
    }, [min, resolvedMax, setImageNum]);

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
            max={resolvedMax}
            min={min}
            placeholder={`${min}-${resolvedMax}`}
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
      <Tabs
        activeKey={String(imageNum)}
        items={options.map((item) => ({ ...item, disabled }))}
        style={{ width: '100%' }}
        styles={{
          list: { display: 'flex', width: '100%' },
          tab: { flex: 1 },
        }}
        onChange={handleChange}
      />
    );
  },
);

ImageNum.displayName = 'ImageCountSelector';

export default ImageNum;
