'use client';

import { Avatar, Block, Button, Flexbox, Input, Select, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';

import { describeGrant, useCredentialGrants } from './useSharedDeviceCredential';

const styles = stylex.create({
  card: {
    paddingBlock: 2,
    paddingInline: 16,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  empty: {
    paddingBlock: 24,
    paddingInline: 20,
    borderRadius: cssVar.borderRadiusLG,
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
    backgroundColor: cssVar.colorFillQuaternary,
  },
  row: {
    paddingBlock: 12,
    borderBlockEndWidth: { 'default': 1, ':last-child': 0 },
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
});

interface GrantLogProps {
  isAdmin: boolean;
}

const GrantLog = memo<GrantLogProps>(({ isAdmin }) => {
  const { t } = useTranslation('integration');
  const [repoInput, setRepoInput] = useState('');
  const [repo, setRepo] = useState<string>();
  const [requesterUserId, setRequesterUserId] = useState<string>();
  const { error, grants, hasMore, isLoading, isLoadingMore, loadMore, mutate } =
    useCredentialGrants({ repo, requesterUserId });
  const memberOptions = useMemo(() => {
    const members = new Map(
      grants.map((grant) => [grant.requester.id, grant.requester.name ?? grant.requester.id]),
    );
    return [
      { label: t('github.grants.filter.allMembers'), value: '' },
      ...[...members].map(([value, label]) => ({ label, value })),
    ];
  }, [grants, t]);

  return (
    <Flexbox gap={10}>
      <Flexbox gap={4}>
        <Text strong style={{ fontSize: 16 }}>
          {t('github.grants.title')}
        </Text>
        <Text type="secondary">
          {isAdmin ? t('github.grants.descriptionAdmin') : t('github.grants.descriptionMember')}
        </Text>
      </Flexbox>
      <Flexbox horizontal gap={8} wrap="wrap">
        <Input
          allowClear
          placeholder={t('github.grants.filter.repo')}
          size="small"
          style={{ maxWidth: 240 }}
          value={repoInput}
          onBlur={() => setRepo(repoInput.trim() || undefined)}
          onPressEnter={() => setRepo(repoInput.trim() || undefined)}
          onChange={(event) => {
            setRepoInput(event.target.value);
            if (!event.target.value) setRepo(undefined);
          }}
        />
        {isAdmin && (
          <Select
            options={memberOptions}
            size="small"
            style={{ minWidth: 160 }}
            value={requesterUserId ?? ''}
            onChange={(value: string) => setRequesterUserId(value || undefined)}
          />
        )}
      </Flexbox>
      {error && grants.length === 0 ? (
        <AsyncError error={error} variant={'block'} onRetry={() => mutate()} />
      ) : !isLoading && grants.length === 0 ? (
        <div {...stylex.props(styles.empty)}>{t('github.grants.empty')}</div>
      ) : (
        <Block {...stylex.props(styles.card)} variant={'filled'}>
          {grants.map((grant) => {
            const row = describeGrant(grant, t as (key: string) => string);
            return (
              <Flexbox
                horizontal
                align="center"
                gap={12}
                key={grant.id}
                {...stylex.props(styles.row)}
              >
                <Avatar avatar={grant.requester.avatar ?? undefined} size={28} title={row.name} />
                <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                  <Text ellipsis strong>
                    {row.name}
                  </Text>
                  <Text ellipsis style={{ fontSize: 13 }} type="secondary">
                    {row.repo}
                  </Text>
                </Flexbox>
                <Tag size="small">{row.path}</Tag>
                <Tag color={row.tone} size="small">
                  {row.result}
                </Tag>
                <Text style={{ flex: 'none', fontSize: 12 }} type="secondary">
                  {new Date(grant.createdAt).toLocaleString()}
                </Text>
              </Flexbox>
            );
          })}
        </Block>
      )}
      {hasMore && (
        <Button
          loading={isLoadingMore}
          size="small"
          style={{ alignSelf: 'center' }}
          onClick={loadMore}
        >
          {t('github.grants.loadMore')}
        </Button>
      )}
    </Flexbox>
  );
});

GrantLog.displayName = 'GithubIntegrationGrantLog';

export default GrantLog;
