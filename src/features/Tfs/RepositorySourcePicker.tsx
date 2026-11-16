'use client';

import { parseTfsRepository } from '@lobechat/utils/tfs';
import { Flexbox, Select } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import GithubRepositoryPicker from '@/features/EnvironmentManager/GithubRepositoryPicker';

import { TfsRepositoryPicker } from './TfsRepositoryPicker';

export interface RepositorySourceSelection {
  defaultBranch?: string;
  name: string;
  url: string;
}

export const RepositorySourcePicker = ({
  onChange,
  onLeave,
  value,
}: {
  onChange: (selection: RepositorySourceSelection | undefined) => void;
  onLeave?: () => void;
  value?: RepositorySourceSelection;
}) => {
  const { t } = useTranslation('integration');
  const [provider, setProvider] = useState(parseTfsRepository(value?.url ?? '') ? 'tfs' : 'github');
  const github =
    provider === 'github' && value?.url.startsWith('https://github.com/')
      ? value.url.slice('https://github.com/'.length).split('/')
      : undefined;
  return (
    <Flexbox gap={12}>
      <Select
        aria-label={t('tfs.provider')}
        value={provider}
        options={[
          { label: 'GitHub', value: 'github' },
          { label: 'TFS / Azure DevOps', value: 'tfs' },
        ]}
        onChange={(value) => {
          setProvider(String(value));
          onChange(undefined);
        }}
      />
      {provider === 'tfs' ? (
        <TfsRepositoryPicker
          onClear={() => onChange(undefined)}
          onLeave={onLeave}
          onSelect={(repo) =>
            onChange({ defaultBranch: repo.defaultBranch, name: repo.name, url: repo.remoteUrl })
          }
        />
      ) : (
        <GithubRepositoryPicker
          value={
            github
              ? { owner: github[0], repository: github[1], defaultBranch: value?.defaultBranch }
              : undefined
          }
          onLeave={onLeave}
          onChange={(repo) =>
            onChange(
              repo
                ? {
                    defaultBranch: repo.defaultBranch,
                    name: repo.repository,
                    url: `https://github.com/${repo.owner}/${repo.repository}`,
                  }
                : undefined,
            )
          }
        />
      )}
    </Flexbox>
  );
};
