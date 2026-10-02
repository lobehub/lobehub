'use client';

import { Flexbox } from '@lobehub/ui';
import { Checkbox, Switch, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Check } from 'lucide-react';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApiKeyScope } from '@/const/apiKeyScope';
import { isValidApiKeyScope } from '@/const/apiKeyScope';

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
  grantCheck: css`
    flex: none;
    color: ${cssVar.colorSuccess};
  `,
  /* Granted-only list: one row per domain the key actually reaches. Hairline
     separators, no card-in-card — the surrounding card is the container. */
  grantList: css`
    padding-block: 4px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  grantRow: css`
    padding-block: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
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
 * Scope groups shown to the user. Most domains carry read and write scopes;
 * usage is intentionally read-only, while two domains carry an additional
 * high-risk tier that is separate from plain write:
 *
 * - `model:invoke` burns money;
 * - `agent:credential:write` installs a secret into one of an agent's
 *   accounts — managing the agent's accounts must not imply that.
 */
type ScopeGroupKey =
  'agent' | 'chat' | 'file' | 'knowledge' | 'mcp' | 'model' | 'usage' | 'user' | 'workspace';

/**
 * Labels an extra scope can carry. Kept as literals (not `string`) so the
 * `t()` calls stay inside the generated key union.
 */
type ScopeExtraLabel =
  'apikey.scopes.agentCredential' | 'apikey.scopes.invoke' | 'apikey.scopes.modelInvoke';

interface ScopeGroup {
  /**
   * A higher-risk scope in the same domain. It gets its own checkbox in the
   * creation grid and its own entry in the granted-scopes overview; the two
   * labels differ because the grid spells the act out while the overview lists
   * grants next to "Read" / "Write".
   */
  readonly extra?: {
    readonly createLabel: ScopeExtraLabel;
    readonly overviewLabel: ScopeExtraLabel;
    readonly scope: ApiKeyScope;
  };
  readonly key: ScopeGroupKey;
  readonly label: `apikey.scopes.groups.${ScopeGroupKey}`;
  readonly read: ApiKeyScope;
  readonly write?: ApiKeyScope;
}

const SCOPE_GROUPS: readonly ScopeGroup[] = [
  {
    key: 'agent',
    label: 'apikey.scopes.groups.agent',
    read: 'agent:read',
    write: 'agent:write',
    extra: {
      createLabel: 'apikey.scopes.agentCredential',
      overviewLabel: 'apikey.scopes.agentCredential',
      scope: 'agent:credential:write',
    },
  },
  { key: 'chat', label: 'apikey.scopes.groups.chat', read: 'chat:read', write: 'chat:write' },
  {
    key: 'model',
    label: 'apikey.scopes.groups.model',
    read: 'model:read',
    write: 'model:write',
    extra: {
      createLabel: 'apikey.scopes.modelInvoke',
      overviewLabel: 'apikey.scopes.invoke',
      scope: 'model:invoke',
    },
  },
  { key: 'file', label: 'apikey.scopes.groups.file', read: 'file:read', write: 'file:write' },
  {
    key: 'knowledge',
    label: 'apikey.scopes.groups.knowledge',
    read: 'knowledge:read',
    write: 'knowledge:write',
  },
  { key: 'mcp', label: 'apikey.scopes.groups.mcp', read: 'mcp:read', write: 'mcp:write' },
  { key: 'usage', label: 'apikey.scopes.groups.usage', read: 'usage:read' },
  {
    key: 'workspace',
    label: 'apikey.scopes.groups.workspace',
    read: 'workspace:read',
    write: 'workspace:write',
  },
  { key: 'user', label: 'apikey.scopes.groups.user', read: 'user:read', write: 'user:write' },
];

export interface ScopeOverviewProps {
  scopes: string[];
}

/**
 * What the key can actually do, one row per granted domain.
 *
 * Deliberately NOT the creation grid frozen read-only: creation must offer
 * every option because you are choosing, but inspection answers "what does
 * this key reach", and a 15-cell grid with 4 ticks buries that answer in the
 * 11 it doesn't have. Granted scopes are rendered verbatim from storage (no
 * write→read derivation), so the list stays an honest mirror of the database.
 */
export const ScopeOverview: FC<ScopeOverviewProps> = ({ scopes }) => {
  const { t } = useTranslation('auth');
  const scopeSet = new Set(scopes);
  const separator = t('apikey.scopes.separator');

  const grants = SCOPE_GROUPS.flatMap((group) => {
    const actions = [
      scopeSet.has(group.read) && t('apikey.scopes.read'),
      group.write && scopeSet.has(group.write) && t('apikey.scopes.write'),
      group.extra && scopeSet.has(group.extra.scope) && t(group.extra.overviewLabel),
    ].filter(Boolean) as string[];

    return actions.length > 0 ? [{ actions, key: group.key, label: t(group.label) }] : [];
  });

  // A restricted key always carries at least one scope, but never render an
  // empty bordered box if that invariant ever breaks.
  if (grants.length === 0) return <Text type={'secondary'}>{t('apikey.scopes.none')}</Text>;

  return (
    <Flexbox className={styles.grantList}>
      {grants.map((grant) => (
        <Flexbox horizontal align={'center'} className={styles.grantRow} gap={10} key={grant.key}>
          <Check className={styles.grantCheck} size={16} />
          <span style={{ fontSize: 13 }}>
            <strong>{grant.label}</strong>
            {t('apikey.scopes.grantJoin')}
            {grant.actions.join(separator)}
          </span>
        </Flexbox>
      ))}
    </Flexbox>
  );
};

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
      // write implies read — keep the UI honest about what the key can do.
      // Only when that read scope actually exists: a standalone high-risk
      // write (`agent:credential:write`) has no read twin, and inventing one
      // would submit a scope the API rejects.
      if (scope.endsWith(':write')) {
        const twin = scope.replace(/:write$/, ':read') as ApiKeyScope;
        if (isValidApiKeyScope(twin)) next.add(twin);
      }
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
                    onChange={(checked) => toggle(group.read, checked)}
                  >
                    {t('apikey.scopes.read')}
                  </Checkbox>
                  {group.write && (
                    <Checkbox
                      checked={selectedSet.has(group.write)}
                      disabled={fullAccess}
                      onChange={(checked) => group.write && toggle(group.write, checked)}
                    >
                      {t('apikey.scopes.write')}
                    </Checkbox>
                  )}
                  {group.extra && (
                    <Checkbox
                      checked={selectedSet.has(group.extra.scope)}
                      disabled={fullAccess}
                      onChange={(checked) => group.extra && toggle(group.extra.scope, checked)}
                    >
                      {t(group.extra.createLabel)}
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
