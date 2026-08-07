'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { Checkbox } from 'antd';
import { createStaticStyles } from 'antd-style';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import { type ApiKeyScope } from '@/const/apiKeyScope';

const styles = createStaticStyles(({ css, cssVar }) => ({
  disabled: css`
    pointer-events: none;
    opacity: 0.45;
  `,
  fullAccessRow: css`
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;

    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 16px;

    /* same card treatment as the full-access row so the whole Scope block
       reads as one system */
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  groupTitle: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  scopeRow: css`
    flex-wrap: wrap;

    /* keep each label on one line; overflowing items wrap as a whole */
    .ant-checkbox-wrapper {
      align-items: center;
      white-space: nowrap;

      /* antd offsets the box against the first text line (top: 0.2em /
         flex-start); with this theme's box size that sinks it below the
         label's midline — pin it back to true center */
      .ant-checkbox {
        inset-block-start: 0;
        align-self: center;
      }
    }
  `,
}));

/**
 * Scope groups shown to the user. Each group carries a read and a write
 * scope; the model group additionally carries the money-burning
 * `model:invoke` tier.
 */
const SCOPE_GROUPS = [
  { key: 'agent', label: 'apikey.scopes.groups.agent', read: 'agent:read', write: 'agent:write' },
  { key: 'chat', label: 'apikey.scopes.groups.chat', read: 'chat:read', write: 'chat:write' },
  { key: 'model', label: 'apikey.scopes.groups.model', read: 'model:read', write: 'model:write' },
  { key: 'file', label: 'apikey.scopes.groups.file', read: 'file:read', write: 'file:write' },
  {
    key: 'knowledge',
    label: 'apikey.scopes.groups.knowledge',
    read: 'knowledge:read',
    write: 'knowledge:write',
  },
  {
    key: 'workspace',
    label: 'apikey.scopes.groups.workspace',
    read: 'workspace:read',
    write: 'workspace:write',
  },
  { key: 'user', label: 'apikey.scopes.groups.user', read: 'user:read', write: 'user:write' },
] as const satisfies { key: string; label: string; read: ApiKeyScope; write: ApiKeyScope }[];

export interface ScopeSelectorProps {
  fullAccess: boolean;
  onFullAccessChange: (fullAccess: boolean) => void;
  onSelectedChange: (selected: ApiKeyScope[]) => void;
  selected: ApiKeyScope[];
}

const ScopeSelector: FC<ScopeSelectorProps> = ({
  fullAccess,
  onFullAccessChange,
  onSelectedChange,
  selected,
}) => {
  const { t } = useTranslation('auth');
  const selectedSet = new Set(selected);

  const toggle = (scope: ApiKeyScope, checked: boolean) => {
    const next = new Set(selectedSet);
    if (checked) {
      next.add(scope);
      // write implies read — keep the UI honest about what the key can do
      if (scope.endsWith(':write')) next.add(scope.replace(/:write$/, ':read') as ApiKeyScope);
    } else {
      next.delete(scope);
      // dropping read also drops the write that implied it
      if (scope.endsWith(':read')) next.delete(scope.replace(/:read$/, ':write') as ApiKeyScope);
    }

    onSelectedChange([...next]);
  };

  return (
    <Flexbox gap={12}>
      <div className={styles.fullAccessRow}>
        <Flexbox gap={2}>
          <Text style={{ fontSize: 14 }}>{t('apikey.form.fields.scopes.fullAccess')}</Text>
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {t('apikey.form.fields.scopes.fullAccessDescription')}
          </Text>
        </Flexbox>
        <Switch checked={fullAccess} onChange={onFullAccessChange} />
      </div>

      <div className={fullAccess ? styles.disabled : undefined}>
        <Flexbox gap={10}>
          <div className={styles.grid}>
            {SCOPE_GROUPS.map((group) => (
              <Flexbox gap={4} key={group.key}>
                <span className={styles.groupTitle}>{t(group.label)}</span>
                <Flexbox horizontal className={styles.scopeRow} gap={12}>
                  <Checkbox
                    checked={selectedSet.has(group.read)}
                    disabled={fullAccess}
                    onChange={(e) => toggle(group.read, e.target.checked)}
                  >
                    {t('apikey.scopes.read')}
                  </Checkbox>
                  <Checkbox
                    checked={selectedSet.has(group.write)}
                    disabled={fullAccess}
                    onChange={(e) => toggle(group.write, e.target.checked)}
                  >
                    {t('apikey.scopes.write')}
                  </Checkbox>
                  {group.key === 'model' && (
                    <Checkbox
                      checked={selectedSet.has('model:invoke')}
                      disabled={fullAccess}
                      onChange={(e) => toggle('model:invoke', e.target.checked)}
                    >
                      {t('apikey.scopes.modelInvoke')}
                    </Checkbox>
                  )}
                </Flexbox>
              </Flexbox>
            ))}
          </div>
        </Flexbox>
      </div>
    </Flexbox>
  );
};

export default ScopeSelector;
