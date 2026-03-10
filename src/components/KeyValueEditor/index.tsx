import { ActionIcon, Button, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import fastDeepEqual from 'fast-deep-equal';
import { LucidePlus, LucideTrash } from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';

import { FormInput } from '@/components/FormInput';

import { type KeyValueItem } from './utils';
import { localListToRecord, recordToLocalList } from './utils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    position: relative;

    width: 100%;
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  input: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
  `,
  row: css`
    margin-block-end: 8px;

    &:last-child {
      margin-block-end: 0;
    }
  `,
  title: css`
    margin-block-end: 8px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

export interface KeyValueEditorProps {
  addButtonText?: string;
  deleteTooltip?: string;
  duplicateKeyErrorText?: string;
  keyPlaceholder?: string;
  onChange?: (value: Record<string, string>) => void;
  style?: CSSProperties;
  value?: Record<string, string>;
  valuePlaceholder?: string;
}

const KeyValueEditor = memo<KeyValueEditorProps>(
  ({
    value,
    onChange,
    keyPlaceholder,
    valuePlaceholder,
    addButtonText,
    duplicateKeyErrorText,
    deleteTooltip,
    style,
  }) => {
    const { t } = useTranslation('components');
    const [items, setItems] = useState<KeyValueItem[]>(() => recordToLocalList(value));
    const prevValueRef = useRef<Record<string, string> | undefined>(undefined);

    useEffect(() => {
      const externalRecord = value || {};
      if (!fastDeepEqual(externalRecord, prevValueRef.current)) {
        setItems(recordToLocalList(externalRecord));
        prevValueRef.current = externalRecord;
      }
    }, [value]);

    const triggerChange = (newItems: KeyValueItem[]) => {
      const keysCount: Record<string, number> = {};
      newItems.forEach((item) => {
        const trimmedKey = item.key.trim();
        if (trimmedKey) {
          keysCount[trimmedKey] = (keysCount[trimmedKey] || 0) + 1;
        }
      });
      setItems(
        newItems.map((item) => ({
          ...item,
        })),
      );
      onChange?.(localListToRecord(newItems));
    };

    const handleAdd = () => {
      const newItems = [...items, { id: uuidv4(), key: '', value: '' }];
      triggerChange(newItems);
    };

    const handleRemove = (id: string) => {
      const newItems = items.filter((item) => item.id !== id);
      triggerChange(newItems);
    };

    const handleKeyChange = (id: string, newKey: string) => {
      const newItems = items.map((item) => (item.id === id ? { ...item, key: newKey } : item));
      triggerChange(newItems);
    };

    const handleValueChange = (id: string, newValue: string) => {
      const newItems = items.map((item) => (item.id === id ? { ...item, value: newValue } : item));
      triggerChange(newItems);
    };

    const getDuplicateKeys = (currentItems: KeyValueItem[]): Set<string> => {
      const keys = new Set<string>();
      const duplicates = new Set<string>();
      currentItems.forEach((item) => {
        const trimmedKey = item.key.trim();
        if (trimmedKey) {
          if (keys.has(trimmedKey)) {
            duplicates.add(trimmedKey);
          } else {
            keys.add(trimmedKey);
          }
        }
      });
      return duplicates;
    };
    const duplicateKeys = getDuplicateKeys(items);

    return (
      <div className={styles.container} style={style}>
        <Flexbox horizontal className={styles.title} gap={8}>
          <Flexbox flex={1}>{keyPlaceholder || t('KeyValueEditor.keyPlaceholder')}</Flexbox>
          <Flexbox flex={2}>{valuePlaceholder || t('KeyValueEditor.valuePlaceholder')}</Flexbox>
          <Flexbox style={{ width: 30 }} />
        </Flexbox>
        <Flexbox width={'100%'}>
          {items.map((item) => {
            const isDuplicate = item.key.trim() && duplicateKeys.has(item.key.trim());
            return (
              <Flexbox
                horizontal
                align="flex-start"
                className={styles.row}
                gap={8}
                key={item.id}
                width={'100%'}
              >
                <Flexbox flex={1} style={{ position: 'relative' }}>
                  <FormInput
                    className={styles.input}
                    placeholder={keyPlaceholder || t('KeyValueEditor.keyPlaceholder')}
                    status={isDuplicate ? 'error' : undefined}
                    value={item.key}
                    variant={'filled'}
                    onChange={(e) => handleKeyChange(item.id, e)}
                  />
                  {isDuplicate && (
                    <div
                      style={{
                        bottom: '-16px',
                        color: 'red',
                        fontSize: '12px',
                        position: 'absolute',
                      }}
                    >
                      {duplicateKeyErrorText || t('KeyValueEditor.duplicateKeyError')}
                    </div>
                  )}
                </Flexbox>
                <Flexbox flex={2}>
                  <FormInput
                    className={styles.input}
                    placeholder={valuePlaceholder || t('KeyValueEditor.valuePlaceholder')}
                    value={item.value}
                    variant={'filled'}
                    onChange={(value) => handleValueChange(item.id, value)}
                  />
                </Flexbox>
                <ActionIcon
                  icon={LucideTrash}
                  size={'small'}
                  style={{ marginTop: 4 }}
                  title={deleteTooltip || t('KeyValueEditor.deleteTooltip')}
                  onClick={() => handleRemove(item.id)}
                />
              </Flexbox>
            );
          })}
          <Button
            block
            icon={<Icon icon={LucidePlus} />}
            size={'small'}
            style={{ marginTop: items.length > 0 ? 16 : 8 }}
            type="dashed"
            onClick={handleAdd}
          >
            {addButtonText || t('KeyValueEditor.addButton')}
          </Button>
        </Flexbox>
      </div>
    );
  },
);

export default KeyValueEditor;
