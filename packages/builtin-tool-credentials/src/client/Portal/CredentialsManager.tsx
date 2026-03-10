import { Button, Empty, Flexbox, InputPassword, Text } from '@lobehub/ui';
import { Input, message, Popconfirm, Select } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CredentialItem } from '../../ExecutionRuntime';
import {
  cloneKeyVaults,
  deleteAtPath,
  filterCredentialItems,
  flattenStringLeaves,
  isValidPath,
  normalizePath,
  setValueAtPath,
} from '../shared/credentialUtils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionButtons: css`
    flex-wrap: wrap;
  `,
  card: css`
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
  `,
  danger: css`
    color: ${cssVar.colorError};
  `,
  errorText: css`
    font-size: 12px;
    color: ${cssVar.colorError};
  `,
  list: css`
    overflow: auto;
    max-height: 420px;
  `,
  pathText: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
  `,
  valueInput: css`
    inline-size: min(320px, 100%);
  `,
  valueRow: css`
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  `,
}));

export interface CredentialsManagerProps {
  forcedPrefix?: string;
  keyVaults: Record<string, any>;
  onPersist: (next: Record<string, any>) => Promise<void>;
}

const MASK_PLACEHOLDER_VALUE = '################################';

const CredentialsManager = memo<CredentialsManagerProps>(
  ({ keyVaults, onPersist, forcedPrefix }) => {
    const { t } = useTranslation('plugin');

    const [prefix, setPrefix] = useState('');
    const [setPathInput, setSetPathInput] = useState('');
    const [setValueInput, setSetValueInput] = useState('');
    const [setError, setSetError] = useState<string | undefined>();
    const [creating, setCreating] = useState(false);
    const [deletingPath, setDeletingPath] = useState<string | undefined>();
    const [updatingPath, setUpdatingPath] = useState<string | undefined>();
    const [editingValues, setEditingValues] = useState<Record<string, string>>({});
    const [activeEditingPath, setActiveEditingPath] = useState<string | undefined>();
    const [revealedPaths, setRevealedPaths] = useState<Record<string, boolean>>({});
    const skipBlurUpdatePathRef = useRef<string | undefined>(undefined);

    useEffect(() => {
      if (forcedPrefix !== undefined) setPrefix(forcedPrefix);
    }, [forcedPrefix]);

    const effectivePrefix = forcedPrefix || prefix;

    const allItems = useMemo<CredentialItem[]>(
      () => flattenStringLeaves(keyVaults || {}),
      [keyVaults],
    );

    const items = useMemo(() => {
      return filterCredentialItems(allItems, effectivePrefix);
    }, [allItems, effectivePrefix]);
    const allPaths = useMemo(() => new Set(allItems.map((item) => item.path)), [allItems]);

    const prefixOptions = useMemo(() => {
      const prefixes = new Set<string>();

      for (const item of allItems) {
        const segments = item.path.split('.');
        for (let index = 1; index <= segments.length - 1; index += 1) {
          prefixes.add(segments.slice(0, index).join('.'));
        }
      }

      return [...prefixes].sort().map((value) => ({ label: value, value }));
    }, [allItems]);

    const persistVaults = async (next: Record<string, any>) => {
      try {
        await onPersist(next);
        return true;
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'unknown error';
        message.error(t('builtins.lobe-credentials.ui.toast.persistFailed', { reason }));
        return false;
      }
    };

    const handleSet = async () => {
      const normalizedPath = normalizePath(setPathInput);

      if (!normalizedPath || !isValidPath(normalizedPath)) {
        setSetError(t('builtins.lobe-credentials.ui.validation.invalidPath'));
        return;
      }

      if (
        forcedPrefix &&
        normalizedPath !== forcedPrefix &&
        !normalizedPath.startsWith(`${forcedPrefix}.`)
      ) {
        setSetError(t('builtins.lobe-credentials.ui.validation.invalidPath'));
        return;
      }

      if (allPaths.has(normalizedPath)) {
        setSetError(t('builtins.lobe-credentials.ui.validation.pathExists'));
        return;
      }

      if (!setValueInput) {
        setSetError(t('builtins.lobe-credentials.ui.validation.emptyValue'));
        return;
      }

      setCreating(true);
      setSetError(undefined);

      const nextKeyVaults = cloneKeyVaults(keyVaults || {});
      setValueAtPath(nextKeyVaults, normalizedPath, setValueInput);

      const ok = await persistVaults(nextKeyVaults);

      setCreating(false);

      if (!ok) return;

      setSetPathInput('');
      setSetValueInput('');
      message.success(t('builtins.lobe-credentials.ui.toast.saved', { path: normalizedPath }));
    };

    const handleUpdate = async (targetPath: string) => {
      const nextValue = editingValues[targetPath];

      if (nextValue === undefined) return;

      if (!nextValue) {
        message.warning(t('builtins.lobe-credentials.ui.validation.emptyValue'));
        return;
      }

      const current = allItems.find((item) => item.path === targetPath)?.value;
      if (current === nextValue) {
        setEditingValues((prev) => {
          const next = { ...prev };
          delete next[targetPath];
          return next;
        });
        return;
      }

      setUpdatingPath(targetPath);

      const nextKeyVaults = cloneKeyVaults(keyVaults || {});
      setValueAtPath(nextKeyVaults, targetPath, nextValue);

      const ok = await persistVaults(nextKeyVaults);
      setUpdatingPath(undefined);

      if (!ok) return;

      setEditingValues((prev) => {
        const next = { ...prev };
        delete next[targetPath];
        return next;
      });
      message.success(t('builtins.lobe-credentials.ui.toast.updated', { path: targetPath }));
    };

    const handleDelete = async (targetPath: string) => {
      setDeletingPath(targetPath);

      const nextKeyVaults = cloneKeyVaults(keyVaults || {});
      const deleted = deleteAtPath(nextKeyVaults, targetPath);

      if (!deleted) {
        setDeletingPath(undefined);
        message.warning(t('builtins.lobe-credentials.ui.toast.deleteNoop', { path: targetPath }));
        return;
      }

      const ok = await persistVaults(nextKeyVaults);
      setDeletingPath(undefined);

      if (!ok) return;
      message.success(t('builtins.lobe-credentials.ui.toast.deleted', { path: targetPath }));
    };

    return (
      <Flexbox gap={12} style={{ width: '100%' }}>
        <Flexbox className={styles.card} gap={8}>
          <Text strong>{t('builtins.lobe-credentials.ui.managerTitle')}</Text>
          {forcedPrefix ? (
            <Select
              disabled
              options={[{ label: forcedPrefix, value: forcedPrefix }]}
              value={forcedPrefix}
            />
          ) : (
            <Select
              allowClear
              showSearch
              options={prefixOptions}
              placeholder={t('builtins.lobe-credentials.ui.prefixPlaceholder')}
              value={prefix || undefined}
              onChange={(nextPrefix) => {
                setPrefix(nextPrefix || '');
              }}
            />
          )}
        </Flexbox>

        <Flexbox className={styles.card} gap={8}>
          <Text strong>
            {t('builtins.lobe-credentials.ui.listTitle', {
              count: items.length,
            })}
          </Text>

          {items.length === 0 ? (
            <Empty
              description={t('builtins.lobe-credentials.ui.empty')}
              image={'https://gw.alipayobjects.com/zos/antfincdn/Z%24BoQpf2zP/empty.svg'}
            />
          ) : (
            <Flexbox className={styles.list} gap={8}>
              {items.map((item) => {
                const isEditing = activeEditingPath === item.path;
                const isRevealed = !!revealedPaths[item.path];
                const editingValue = editingValues[item.path];
                const displayValue =
                  isEditing || isRevealed ? (editingValue ?? item.value) : MASK_PLACEHOLDER_VALUE;

                return (
                  <Flexbox
                    className={styles.card}
                    data-testid={`credential-item-${item.path}`}
                    gap={6}
                    key={item.path}
                  >
                    <span className={styles.pathText}>{item.path}</span>
                    <Flexbox horizontal className={styles.valueRow}>
                      <InputPassword
                        className={styles.valueInput}
                        data-testid={`credential-value-${item.path}`}
                        disabled={updatingPath === item.path}
                        value={displayValue}
                        visibilityToggle={{
                          onVisibleChange: (visible) => {
                            setRevealedPaths((prev) => ({ ...prev, [item.path]: visible }));
                          },
                          visible: isRevealed,
                        }}
                        onBlur={() => {
                          if (skipBlurUpdatePathRef.current === item.path) {
                            skipBlurUpdatePathRef.current = undefined;
                            return;
                          }
                          setActiveEditingPath((prev) => (prev === item.path ? undefined : prev));
                          void handleUpdate(item.path);
                        }}
                        onChange={(e) => {
                          setEditingValues((prev) => ({ ...prev, [item.path]: e.target.value }));
                        }}
                        onFocus={() => {
                          setActiveEditingPath(item.path);
                          setEditingValues((prev) => {
                            if (prev[item.path] !== undefined) return prev;
                            return { ...prev, [item.path]: item.value };
                          });
                        }}
                        onPressEnter={() => {
                          setActiveEditingPath((prev) => (prev === item.path ? undefined : prev));
                          void handleUpdate(item.path);
                        }}
                      />
                      <Popconfirm
                        title={t('builtins.lobe-credentials.ui.confirmDelete', { path: item.path })}
                        onConfirm={() => {
                          void handleDelete(item.path);
                        }}
                      >
                        <Button
                          danger
                          data-testid={`credential-delete-${item.path}`}
                          loading={deletingPath === item.path}
                          size={'small'}
                          type={'default'}
                          onMouseDown={() => {
                            skipBlurUpdatePathRef.current = item.path;
                          }}
                        >
                          <span className={styles.danger}>
                            {t('builtins.lobe-credentials.ui.delete')}
                          </span>
                        </Button>
                      </Popconfirm>
                    </Flexbox>
                  </Flexbox>
                );
              })}
            </Flexbox>
          )}
        </Flexbox>

        <Flexbox className={styles.card} gap={8}>
          <Text strong>{t('builtins.lobe-credentials.ui.setTitle')}</Text>
          <Input
            placeholder={t('builtins.lobe-credentials.ui.pathPlaceholder')}
            value={setPathInput}
            onChange={(e) => {
              setSetPathInput(e.target.value);
              setSetError(undefined);
            }}
          />
          <InputPassword
            autoComplete={'new-password'}
            placeholder={t('builtins.lobe-credentials.ui.valuePlaceholder')}
            value={setValueInput}
            onChange={(e) => {
              setSetValueInput(e.target.value);
              setSetError(undefined);
            }}
          />
          {!!setError && <span className={styles.errorText}>{setError}</span>}
          <Flexbox horizontal className={styles.actionButtons} gap={8}>
            <Button loading={creating} type={'primary'} onClick={handleSet}>
              {t('builtins.lobe-credentials.ui.save')}
            </Button>
            <Button
              onClick={() => {
                setSetPathInput('');
                setSetValueInput('');
                setSetError(undefined);
              }}
            >
              {t('builtins.lobe-credentials.ui.clear')}
            </Button>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  },
);

CredentialsManager.displayName = 'CredentialsManager';

export default CredentialsManager;
