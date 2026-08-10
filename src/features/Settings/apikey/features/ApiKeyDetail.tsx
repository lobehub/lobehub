'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button, Drawer, Switch } from '@lobehub/ui/base-ui';
import { Popconfirm } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Pencil, Trash } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  API_KEY_FULL_ACCESS_SCOPE,
  type ApiKeyScope,
  isFullAccessApiKey,
} from '@/const/apiKeyScope';
import { type ApiKeyItem, type UpdateApiKeyParams } from '@/types/apiKey';

import ScopeSelector, { ScopeOverview } from './ApiKeyModal/ScopeSelector';
import { ApiKeyDisplay, EditableCell } from './index';

const styles = createStaticStyles(({ css, cssVar }) => ({
  fullAccessCard: css`
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  label: css`
    flex: none;
    width: 96px;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  metaRow: css`
    display: flex;
    gap: 16px;
    align-items: center;
    min-height: 28px;
  `,
  sectionTitle: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  value: css`
    overflow: hidden;
    display: flex;
    align-items: center;
    font-size: 13px;
  `,
}));

export interface ApiKeyDetailProps {
  apiKey?: ApiKeyItem;
  canDelete: boolean;
  canEdit: boolean;
  manageTooltip: string;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  onUpdate: (id: string, params: UpdateApiKeyParams) => Promise<boolean>;
  open: boolean;
}

interface ApiKeyScopeEditorProps {
  apiKey: ApiKeyItem;
  canEdit: boolean;
  onUpdate: (id: string, params: UpdateApiKeyParams) => Promise<boolean>;
}

const ApiKeyScopeEditor: FC<ApiKeyScopeEditorProps> = ({ apiKey, canEdit, onUpdate }) => {
  const { t } = useTranslation('auth');
  const initialFullAccess = isFullAccessApiKey(apiKey.scopes);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fullAccess, setFullAccess] = useState(initialFullAccess);
  const [selected, setSelected] = useState<ApiKeyScope[]>(
    initialFullAccess ? [] : (apiKey.scopes as ApiKeyScope[]),
  );
  const scopeMissing = !fullAccess && selected.length === 0;

  if (editing) {
    return (
      <Flexbox gap={12}>
        <ScopeSelector
          fullAccess={fullAccess}
          selected={selected}
          onFullAccessChange={setFullAccess}
          onSelectedChange={setSelected}
        />
        <Flexbox horizontal gap={8} justify={'flex-end'}>
          <Button
            type="text"
            onClick={() => {
              setFullAccess(initialFullAccess);
              setSelected(initialFullAccess ? [] : (apiKey.scopes as ApiKeyScope[]));
              setEditing(false);
            }}
          >
            {t('apikey.detail.permissions.cancel')}
          </Button>
          <Button
            disabled={scopeMissing}
            loading={saving}
            type="primary"
            onClick={async () => {
              setSaving(true);
              try {
                const success = await onUpdate(apiKey.id, {
                  scopes: fullAccess ? [API_KEY_FULL_ACCESS_SCOPE] : selected,
                });
                if (success) setEditing(false);
              } catch {
                // The mutation owns user-facing error feedback. Keep the
                // editor open so the selected grants are not lost.
              } finally {
                setSaving(false);
              }
            }}
          >
            {t('apikey.detail.permissions.save')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={8}>
      {initialFullAccess ? (
        <Flexbox className={styles.fullAccessCard} gap={2}>
          <Text style={{ fontSize: 14 }}>{t('apikey.scopes.fullAccess')}</Text>
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {t('apikey.form.fields.scopes.fullAccessDescription')}
          </Text>
        </Flexbox>
      ) : (
        <ScopeOverview scopes={apiKey.scopes!} />
      )}
      {canEdit && (
        <Flexbox horizontal justify={'flex-end'}>
          <Button icon={Pencil} type="text" onClick={() => setEditing(true)}>
            {t('apikey.detail.permissions.edit')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
};

/**
 * Full detail of one API key — the list's scopes column can only truncate.
 * Same management surface as the list rows (rename / toggle / delete), and
 * the scope grid mirrors the creation modal so create and inspect read as one
 * system. The creator may edit scopes in place; admins may revoke other
 * members' keys but cannot change their grants.
 */
const ApiKeyDetail: FC<ApiKeyDetailProps> = ({
  apiKey,
  canDelete,
  canEdit,
  manageTooltip,
  onClose,
  onDelete,
  onUpdate,
  open,
}) => {
  const { t } = useTranslation('auth');

  return (
    <Drawer
      open={open}
      placement={'right'}
      title={t('apikey.detail.title')}
      width={'min(92vw, 520px)'}
      onClose={onClose}
    >
      {apiKey && (
        <Flexbox gap={24}>
          <Flexbox gap={4}>
            <div className={styles.metaRow}>
              <span className={styles.label}>{t('apikey.list.columns.name')}</span>
              <span className={styles.value}>
                <EditableCell
                  disabled={!canEdit}
                  placeholder={t('apikey.display.enterPlaceholder')}
                  type="text"
                  value={apiKey.name}
                  onSubmit={(name) => {
                    if (!canEdit || !name || name === apiKey.name) return;
                    void onUpdate(apiKey.id, { name: name as string });
                  }}
                />
              </span>
            </div>

            <div className={styles.metaRow}>
              <span className={styles.label}>{t('apikey.list.columns.key')}</span>
              <span className={styles.value}>
                {apiKey.isMine === false ? (
                  <span style={{ opacity: 0.5 }}>{`sk-lh-${'*'.repeat(12)}`}</span>
                ) : apiKey.keyDecryptionFailed ? (
                  <span title={t('apikey.display.unavailableDescription')}>
                    {t('apikey.display.unavailable')}
                  </span>
                ) : (
                  <ApiKeyDisplay apiKey={apiKey.key} />
                )}
              </span>
            </div>

            {apiKey.creator && (
              <div className={styles.metaRow}>
                <span className={styles.label}>{t('apikey.list.columns.creator')}</span>
                <span className={styles.value}>{apiKey.creator}</span>
              </div>
            )}

            <div className={styles.metaRow}>
              <span className={styles.label}>{t('apikey.detail.createdAt')}</span>
              <span className={styles.value}>{apiKey.createdAt.toLocaleString()}</span>
            </div>

            <div className={styles.metaRow}>
              <span className={styles.label}>{t('apikey.list.columns.lastUsedAt')}</span>
              <span className={styles.value}>
                {apiKey.lastUsedAt?.toLocaleString() || t('apikey.display.neverUsed')}
              </span>
            </div>

            <div className={styles.metaRow}>
              <span className={styles.label}>{t('apikey.list.columns.expiresAt')}</span>
              <span className={styles.value}>
                <EditableCell
                  disabled={!canEdit}
                  placeholder={t('apikey.display.neverExpires')}
                  type="date"
                  value={apiKey.expiresAt?.toLocaleString() || t('apikey.display.neverExpires')}
                  onSubmit={(expiresAt) => {
                    if (!canEdit || expiresAt === apiKey.expiresAt) return;
                    void onUpdate(apiKey.id, {
                      expiresAt: expiresAt ? new Date(expiresAt as string) : null,
                    });
                  }}
                />
              </span>
            </div>

            <div className={styles.metaRow}>
              <span className={styles.label}>{t('apikey.list.columns.status')}</span>
              <span className={styles.value} title={canEdit ? undefined : manageTooltip}>
                <Switch
                  checked={!!apiKey.enabled}
                  disabled={!canEdit}
                  onChange={(checked) => {
                    if (!canEdit) return;
                    void onUpdate(apiKey.id, { enabled: checked });
                  }}
                />
              </span>
            </div>
          </Flexbox>

          <Flexbox gap={8}>
            <span className={styles.sectionTitle}>{t('apikey.form.fields.scopes.label')}</span>
            <ApiKeyScopeEditor
              apiKey={apiKey}
              canEdit={canEdit}
              key={`${apiKey.id}-${apiKey.updatedAt.toISOString()}`}
              onUpdate={onUpdate}
            />
          </Flexbox>

          <Flexbox horizontal justify={'flex-end'}>
            <Popconfirm
              cancelText={t('apikey.list.actions.deleteConfirm.actions.cancel')}
              description={t('apikey.list.actions.deleteConfirm.content')}
              okButtonProps={{ disabled: !canDelete }}
              okText={t('apikey.list.actions.deleteConfirm.actions.ok')}
              title={t('apikey.list.actions.deleteConfirm.title')}
              onConfirm={async () => {
                if (!canDelete) return;
                await onDelete(apiKey.id);
              }}
            >
              <Button
                danger
                disabled={!canDelete}
                icon={Trash}
                title={canDelete ? t('apikey.list.actions.delete') : manageTooltip}
                type="text"
              >
                {t('apikey.list.actions.delete')}
              </Button>
            </Popconfirm>
          </Flexbox>
        </Flexbox>
      )}
    </Drawer>
  );
};

export default ApiKeyDetail;
