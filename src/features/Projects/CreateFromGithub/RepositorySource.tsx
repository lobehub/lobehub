'use client';

import { cssVar, Flexbox, Input, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { type ParsedGithubRepository, parseGithubRepository } from './githubRepository';
import RepositoryList from './RepositoryList';

export interface RepositorySourceValue {
  /** The branch the picked row reported; a typed URL names none. */
  defaultBranch?: string;
  url: string;
}

/** The repository a value names, or nothing while it names none. */
export const repositoryOf = (value: RepositorySourceValue): ParsedGithubRepository | null =>
  parseGithubRepository(value.url);

interface RepositorySourceProps {
  onChange: (value: RepositorySourceValue) => void;
  /** Leave the dialog for the GitHub integration settings. */
  onConnect: () => void;
  /** Enter in the URL field. */
  onSubmit?: () => void;
  value: RepositorySourceValue;
}

/**
 * Picking a GitHub repository: one the connected GitHub App can read, or a
 * pasted URL. Both dialogs that add a repository ask the same question, so
 * they ask it with the same two controls.
 */
const RepositorySource = ({ onChange, onConnect, onSubmit, value }: RepositorySourceProps) => {
  const { t } = useTranslation('project');
  const repository = repositoryOf(value);
  const urlInvalid = Boolean(value.url.trim()) && !repository;

  return (
    <>
      <RepositoryList
        selected={repository?.fullName}
        onConnect={onConnect}
        onSelect={(picked) =>
          onChange({ defaultBranch: picked.defaultBranch, url: picked.htmlUrl })
        }
      />
      <Flexbox gap={6}>
        <Text fontSize={13} weight={500}>
          {t('createFromGithub.urlLabel')}
        </Text>
        <Input
          aria-invalid={urlInvalid}
          placeholder={t('createFromGithub.urlPlaceholder')}
          style={urlInvalid ? { borderColor: cssVar.colorError } : undefined}
          value={value.url}
          // A typed URL names no branch; the repository's default applies.
          onChange={(event) => onChange({ url: event.target.value })}
          onPressEnter={onSubmit}
        />
        {urlInvalid && (
          <Text fontSize={12} type={'danger'}>
            {t('createFromGithub.urlInvalid')}
          </Text>
        )}
      </Flexbox>
    </>
  );
};

export default RepositorySource;
