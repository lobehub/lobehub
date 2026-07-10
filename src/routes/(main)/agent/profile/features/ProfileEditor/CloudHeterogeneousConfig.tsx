'use client';

import { type HeterogeneousProviderConfig, type UserCredSummary } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { Flexbox } from '@lobehub/ui';
import { Button, Select } from '@lobehub/ui/base-ui';
import { Avatar, Input, Spin, Tag, Typography } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckCircle2, KeyRound, X } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';

// Fixed cred key for Claude Code OAuth token — never changes
const CLAUDE_TOKEN_CRED_KEY = 'CLAUDE_CODE_OAUTH_TOKEN';

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
    text-transform: uppercase;
    letter-spacing: 0.04em;
  `,
}));

interface CloudHeterogeneousConfigProps {
  onEnvChange: (env: Record<string, string>) => Promise<void> | void;
  provider: HeterogeneousProviderConfig;
}

// ── Claude Code Token section ──────────────────────────────────────────────
interface TokenSectionProps {
  existingCred: UserCredSummary | undefined;
  onEnvChange: (patch: Record<string, string>) => void;
  onSaved: () => void;
}

const TokenSection = memo<TokenSectionProps>(({ existingCred, onSaved, onEnvChange }) => {
  const { t } = useTranslation('setting');
  const { allowed: canEdit } = usePermission('edit_own_content');
  const [editing, setEditing] = useState(!existingCred);
  const [tokenInput, setTokenInput] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!canEdit) return;

    const token = tokenInput.trim();
    if (!token) return;
    setSaving(true);
    try {
      await lambdaClient.market.creds.createKV.mutate({
        key: CLAUDE_TOKEN_CRED_KEY,
        name: 'Claude Code OAuth Token',
        type: 'kv-env',
        values: { [CLAUDE_TOKEN_CRED_KEY]: token },
      });
      onEnvChange({ CLAUDE_CODE_CRED_KEY: CLAUDE_TOKEN_CRED_KEY });
      setTokenInput('');
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align="center" justify="space-between">
        <Flexbox horizontal align="center" gap={6}>
          <KeyRound size={12} />
          <span className={styles.sectionLabel}>{t('heterogeneousStatus.cloud.tokenLabel')}</span>
        </Flexbox>
        {existingCred && !editing && (
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
      </Flexbox>

      {existingCred && !editing ? (
        <Flexbox horizontal align="center" gap={8}>
          <Tag
            color="success"
            icon={<CheckCircle2 size={11} />}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            {existingCred.maskedPreview ?? existingCred.name}
          </Tag>
        </Flexbox>
      ) : (
        <Flexbox horizontal gap={8}>
          <Input.Password
            autoComplete="new-password"
            autoFocus={!!existingCred}
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
          {existingCred && (
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

      <span className={styles.sectionDesc}>{t('heterogeneousStatus.cloud.tokenDesc')}</span>
    </Flexbox>
  );
});

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
              <Typography.Text ellipsis style={{ flex: 1, fontSize: 13 }}>
                {repo}
              </Typography.Text>
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

    const currentEnv = provider.env ?? {};
    const storedGithubCredKey = currentEnv.GITHUB_CRED_KEY ?? '';
    const repos: string[] = (() => {
      try {
        return JSON.parse(currentEnv.GITHUB_REPOS ?? '[]');
      } catch {
        return [];
      }
    })();

    const {
      data: credsData,
      isLoading,
      refetch,
    } = lambdaQuery.market.creds.list.useQuery(undefined);
    const allCreds: UserCredSummary[] = credsData?.data ?? [];

    const claudeTokenCred = allCreds.find((c) => c.key === CLAUDE_TOKEN_CRED_KEY);
    const githubCreds = allCreds.filter(
      (c) => c.type === 'oauth' && c.oauthProvider?.toLowerCase().includes('github'),
    );
    const githubCredOptions = githubCreds.map((cred) => ({
      label: (
        <span className={styles.credOption}>
          {cred.oauthAvatar ? <Avatar size={16} src={cred.oauthAvatar} /> : <Github size={14} />}
          <span>{cred.name}</span>
          {cred.oauthUsername && (
            <Typography.Text style={{ fontSize: 12 }} type="secondary">
              @{cred.oauthUsername}
            </Typography.Text>
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

    if (isLoading) {
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
            existingCred={claudeTokenCred}
            onEnvChange={saveEnv}
            onSaved={() => refetch()}
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
              <span className={styles.manageLink} onClick={() => navigate('/settings/creds')}>
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
