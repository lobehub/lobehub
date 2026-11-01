'use client';

import { type HeterogeneousProviderConfig, type UserCredSummary } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import {
  Avatar,
  Button,
  confirmModal,
  createStaticStyles,
  cssVar,
  Flexbox,
  Input,
  InputPassword,
  Select,
  Spin,
  Tag,
  Text,
  toast,
} from '@lobehub/ui';
import { CheckCircle2, KeyRound, X } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import {
  canRemoveClaudeCodeToken,
  CLAUDE_CODE_TOKEN_CRED_KEY,
  type ClaudeCodeTokenStatus,
  resolveClaudeCodeTokenStatus,
} from '@/helpers/claudeCodeTokenCred';
import { usePermission } from '@/hooks/usePermission';
import { refreshScopedCreds, useCredsForContext, usePersonalCreds } from '@/hooks/useScopedCreds';
import { deleteClaudeCodeToken, saveClaudeCodeToken } from '@/services/claudeCodeToken';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    padding-block: 16px 12px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  credOption: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  manageLink: css`
    cursor: pointer;
    font-size: 12px;
    color: ${cssVar.colorPrimary};

    &:hover {
      text-decoration: underline;
    }
  `,
  repoItem: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    min-height: 36px;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    transition: background 0.15s;

    &:hover {
      background: ${cssVar.colorFillTertiary};

      .repo-delete-btn {
        opacity: 1;
      }
    }
  `,
  repoItemActive: css`
    background: ${cssVar.colorFillSecondary};
  `,
  repoDeleteBtn: css`
    cursor: pointer;

    flex-shrink: 0;

    margin-inline-start: auto;
    padding: 2px;
    border: none;
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    opacity: 0;
    background: transparent;

    transition:
      opacity 0.15s,
      color 0.15s;

    &:hover {
      color: ${cssVar.colorError};
    }
  `,
  repoList: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  sectionDesc: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  sectionDivider: css`
    margin-block: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  sectionLabel: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface CloudHeterogeneousConfigProps {
  onEnvChange: (env: Record<string, string>) => Promise<void> | void;
  provider: HeterogeneousProviderConfig;
}

// ── Claude Code Token section ──────────────────────────────────────────────
interface TokenSectionProps {
  inWorkspace: boolean;
  onEnvChange: (patch: Record<string, string>) => void;
  onSaved: () => void;
  /** The caller's own token, if any — saving updates it instead of adding a duplicate key. */
  personalCred?: { id: number; type?: string };
  tokenStatus: ClaudeCodeTokenStatus;
}

const TokenSection = memo<TokenSectionProps>(
  ({ inWorkspace, onEnvChange, onSaved, personalCred, tokenStatus }) => {
    const { t } = useTranslation('setting');
    const { allowed: canEdit } = usePermission('edit_own_content');
    const configured = tokenStatus.status === 'configured';
    const [editing, setEditing] = useState(!configured);
    const [tokenInput, setTokenInput] = useState('');
    const [saving, setSaving] = useState(false);

    if (tokenStatus.status === 'unknown') {
      return (
        <Flexbox gap={8}>
          <Flexbox horizontal align="center" gap={6}>
            <KeyRound size={12} />
            <span className={styles.sectionLabel}>{t('heterogeneousStatus.cloud.tokenLabel')}</span>
          </Flexbox>
          <Flexbox horizontal align="center" gap={8}>
            <Text fontSize={12} type={'warning'}>
              {t('heterogeneousStatus.cloud.tokenLookupError')}
            </Text>
            <Button size={'small'} onClick={onSaved}>
              {t('heterogeneousStatus.cloud.tokenRetry')}
            </Button>
          </Flexbox>
        </Flexbox>
      );
    }

    const handleSave = async () => {
      if (!canEdit) return;

      const token = tokenInput.trim();
      if (!token) return;
      setSaving(true);
      const result = await saveClaudeCodeToken({ inWorkspace, personalCred, token });
      setSaving(false);
      // Refetch either way: a failed share leaves the token saved but unusable
      // here, which the refreshed status shows as the "not shared" warning.
      onSaved();

      if (!result.ok) {
        toast.error(
          t(
            (
              {
                save: 'heterogeneousStatus.cloud.tokenSaveError',
                share: 'creds.share.error',
                type: 'heterogeneousStatus.cloud.tokenTypeMismatch',
              } as const
            )[result.failedStep],
          ),
        );
        return;
      }

      onEnvChange({ CLAUDE_CODE_CRED_KEY: CLAUDE_CODE_TOKEN_CRED_KEY });
      setTokenInput('');
      setEditing(false);
    };

    const canRemove = !!personalCred && canRemoveClaudeCodeToken(tokenStatus);

    const handleRemove = () => {
      if (!canEdit || !personalCred) return;

      confirmModal({
        cancelText: t('heterogeneousStatus.cloud.tokenCancel'),
        content: t('heterogeneousStatus.cloud.tokenRemoveConfirm'),
        okButtonProps: { danger: true },
        okText: t('heterogeneousStatus.cloud.tokenRemove'),
        onOk: async () => {
          const ok = await deleteClaudeCodeToken(personalCred);
          onSaved();
          if (!ok) {
            toast.error(t('heterogeneousStatus.cloud.tokenRemoveError'));
            return;
          }

          onEnvChange({ CLAUDE_CODE_CRED_KEY: '' });
          setTokenInput('');
          setEditing(true);
        },
        title: t('heterogeneousStatus.cloud.tokenRemoveTitle'),
      });
    };

    return (
      <Flexbox gap={8}>
        <Flexbox horizontal align="center" justify="space-between">
          <Flexbox horizontal align="center" gap={6}>
            <KeyRound size={12} />
            <span className={styles.sectionLabel}>{t('heterogeneousStatus.cloud.tokenLabel')}</span>
          </Flexbox>
          <Flexbox horizontal align="center" gap={12}>
            {configured && tokenStatus.editable && !editing && (
              <span
                className={styles.manageLink}
                onClick={() => {
                  if (!canEdit) return;

                  setEditing(true);
                }}
              >
                {t('heterogeneousStatus.cloud.tokenChange')}
              </span>
            )}
            {canRemove && canEdit && !(configured && editing) && (
              <span className={styles.manageLink} onClick={handleRemove}>
                {t('heterogeneousStatus.cloud.tokenRemove')}
              </span>
            )}
          </Flexbox>
        </Flexbox>

        {configured && !editing ? (
          <Flexbox horizontal align="center" gap={8}>
            <Tag
              color="success"
              icon={<CheckCircle2 size={11} />}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              {tokenStatus.display}
            </Tag>
          </Flexbox>
        ) : (
          <Flexbox horizontal gap={8}>
            <InputPassword
              autoComplete="new-password"
              autoFocus={configured}
              disabled={!canEdit}
              placeholder={t('heterogeneousStatus.cloud.tokenPlaceholder')}
              style={{ flex: 1 }}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onPressEnter={handleSave}
            />
            <Button disabled={!canEdit} loading={saving} type="primary" onClick={handleSave}>
              {t('heterogeneousStatus.cloud.tokenSave')}
            </Button>
            {configured && (
              <Button
                onClick={() => {
                  setEditing(false);
                  setTokenInput('');
                }}
              >
                {t('heterogeneousStatus.cloud.tokenCancel')}
              </Button>
            )}
          </Flexbox>
        )}

        {tokenStatus.status === 'personalNotShared' && (
          <Text fontSize={12} type={'warning'}>
            {t('heterogeneousStatus.cloud.tokenNotShared')}
          </Text>
        )}

        <span className={styles.sectionDesc}>{t('heterogeneousStatus.cloud.tokenDesc')}</span>
      </Flexbox>
    );
  },
);

// ── Repo list section ──────────────────────────────────────────────────────
// Profile page: manage the list of repos (add / delete only).
// Active repo selection happens in the bottom-left CloudRepoSwitcher.
interface RepoListSectionProps {
  onReposChange: (repos: string[]) => void;
  repos: string[];
}

const RepoListSection = memo<RepoListSectionProps>(({ repos, onReposChange }) => {
  const { t } = useTranslation('setting');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const [input, setInput] = useState('');

  const addRepo = () => {
    if (!canEdit) return;

    const v = input.trim();
    if (!v || repos.includes(v)) return;
    onReposChange([...repos, v]);
    setInput('');
  };

  const removeRepo = (repo: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;

    onReposChange(repos.filter((r) => r !== repo));
  };

  return (
    <Flexbox gap={8}>
      <span className={styles.sectionLabel}>{t('heterogeneousStatus.cloud.repoLabel')}</span>

      {repos.length > 0 && (
        <div className={styles.repoList}>
          {repos.map((repo) => (
            <div className={styles.repoItem} key={repo}>
              <Github size={14} style={{ flexShrink: 0 }} />
              <Text ellipsis fontSize={13} style={{ flex: 1 }}>
                {repo}
              </Text>
              <button
                className={`${styles.repoDeleteBtn} repo-delete-btn`}
                disabled={!canEdit}
                onClick={(e) => removeRepo(repo, e)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <Flexbox horizontal gap={8}>
        <Input
          disabled={!canEdit}
          placeholder={t('heterogeneousStatus.cloud.repoPlaceholder')}
          style={{ flex: 1 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={addRepo}
        />
        <Button disabled={!canEdit} onClick={addRepo}>
          {t('heterogeneousStatus.cloud.repoAdd')}
        </Button>
      </Flexbox>

      <span className={styles.sectionDesc}>{t('heterogeneousStatus.cloud.repoDesc')}</span>
    </Flexbox>
  );
});

// ── Main component ─────────────────────────────────────────────────────────
const CloudHeterogeneousConfig = memo<CloudHeterogeneousConfigProps>(
  ({ provider, onEnvChange }) => {
    const { t } = useTranslation('setting');
    const navigate = useWorkspaceAwareNavigate();
    const { allowed: canEdit } = usePermission('edit_own_content');
    const inWorkspace = !!useActiveWorkspaceId();

    const currentEnv = provider.env ?? {};
    const storedGithubCredKey = currentEnv.GITHUB_CRED_KEY ?? '';
    const repos: string[] = (() => {
      try {
        return JSON.parse(currentEnv.GITHUB_REPOS ?? '[]');
      } catch {
        return [];
      }
    })();

    const { data: personalCreds, error: personalError, isLoading } = usePersonalCreds();
    const {
      data: contextCreds,
      error: contextError,
      isLoading: isContextLoading,
    } = useCredsForContext();
    const allCreds: UserCredSummary[] = personalCreds ?? [];

    // A failed lookup is unknown, not missing: offering save/share can't fix it.
    const tokenStatus: ClaudeCodeTokenStatus =
      contextError || personalError
        ? { status: 'unknown' }
        : resolveClaudeCodeTokenStatus({
            contextCreds: contextCreds ?? [],
            inWorkspace,
            personalCreds: allCreds,
          });
    const personalTokenCred = allCreds.find((c) => c.key === CLAUDE_CODE_TOKEN_CRED_KEY);
    const githubCreds = allCreds.filter(
      (c) => c.type === 'oauth' && c.oauthProvider?.toLowerCase().includes('github'),
    );
    const githubCredOptions = githubCreds.map((cred) => ({
      label: (
        <span className={styles.credOption}>
          {cred.oauthAvatar ? <Avatar avatar={cred.oauthAvatar} size={16} /> : <Github size={14} />}
          <span>{cred.name}</span>
          {cred.oauthUsername && (
            <Text as={'span'} fontSize={12} type={'secondary'}>
              @{cred.oauthUsername}
            </Text>
          )}
        </span>
      ),
      title: [cred.name, cred.oauthUsername].filter(Boolean).join(' '),
      value: cred.key,
    }));

    const saveEnv = (patch: Record<string, string>) => {
      if (!canEdit) return;

      void onEnvChange({ ...currentEnv, ...patch });
    };

    const handleReposChange = (nextRepos: string[]) => {
      saveEnv({ GITHUB_REPOS: JSON.stringify(nextRepos) });
    };

    if (isLoading || isContextLoading) {
      return (
        <Flexbox align="center" justify="center" style={{ paddingBlock: 32 }}>
          <Spin size="small" />
        </Flexbox>
      );
    }

    return (
      <div className={styles.card}>
        <Flexbox gap={16}>
          {/* ── Claude Code OAuth Token ── */}
          <TokenSection
            inWorkspace={inWorkspace}
            personalCred={personalTokenCred}
            tokenStatus={tokenStatus}
            onEnvChange={saveEnv}
            onSaved={() => void refreshScopedCreds()}
          />

          <div className={styles.sectionDivider} />

          {/* ── GitHub OAuth Credential ── */}
          <Flexbox gap={8}>
            <Flexbox horizontal align="center" justify="space-between">
              <Flexbox horizontal align="center" gap={6}>
                <Github size={12} />
                <span className={styles.sectionLabel}>
                  {t('heterogeneousStatus.cloud.githubLabel')}
                </span>
              </Flexbox>
              <span className={styles.manageLink} onClick={() => navigate('/settings/credential')}>
                {t('heterogeneousStatus.cloud.manageCredentials')}
              </span>
            </Flexbox>

            <Select
              allowClear
              disabled={!canEdit}
              options={githubCredOptions}
              style={{ width: '100%' }}
              value={storedGithubCredKey || null}
              placeholder={
                githubCredOptions.length > 0
                  ? t('heterogeneousStatus.cloud.githubPlaceholder')
                  : t('heterogeneousStatus.cloud.githubNoCreds')
              }
              onChange={(key) => saveEnv({ GITHUB_CRED_KEY: typeof key === 'string' ? key : '' })}
            />

            <span className={styles.sectionDesc}>{t('heterogeneousStatus.cloud.githubDesc')}</span>
          </Flexbox>

          <div className={styles.sectionDivider} />

          {/* ── Repository list ── */}
          <RepoListSection repos={repos} onReposChange={handleReposChange} />
        </Flexbox>
      </div>
    );
  },
);

export default CloudHeterogeneousConfig;
