import type { ScmRepositoryListItem } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { ActionIcon, Button, cssVar, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { ChevronDownIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { parseGithubRepository } from './githubRepository';
import RepositoryList from './RepositoryList';

/** A repository added beside the main one. */
export interface ExtraRepository {
  defaultBranch?: string;
  /** `owner/name`. */
  fullName: string;
  url: string;
}

export const MAX_EXTRA_REPOSITORIES = 9;

interface ExtraRepositoriesProps {
  extras: ExtraRepository[];
  /** What the repositories are checked out into; the project wording by default. */
  hint?: string;
  /** `owner/name` of the main repository, which is never added twice. */
  mainFullName?: string;
  onChange: (extras: ExtraRepository[]) => void;
  /** Leave for the GitHub integration settings. */
  onConnect: () => void;
}

/**
 * Advanced options: more repositories checked out beside the main one, side by
 * side in folders named after them — picked from the connected list or pasted.
 * Collapsed by default; one repository is what most people need. Shared by the
 * project and environment create dialogs.
 */
const ExtraRepositories = ({
  extras,
  hint,
  mainFullName,
  onChange,
  onConnect,
}: ExtraRepositoriesProps) => {
  const { t } = useTranslation('project');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [extraUrl, setExtraUrl] = useState('');

  const extraParsed = parseGithubRepository(extraUrl);
  const extraUrlInvalid = Boolean(extraUrl.trim()) && !extraParsed;
  const isTaken = (fullName: string) =>
    fullName.toLowerCase() === mainFullName?.toLowerCase() ||
    extras.some((item) => item.fullName.toLowerCase() === fullName.toLowerCase());

  /** Adds a repository beside the main one; picking one already there removes it. */
  const toggleExtra = (extra: ExtraRepository) => {
    const key = extra.fullName.toLowerCase();
    if (extras.some((item) => item.fullName.toLowerCase() === key))
      return onChange(extras.filter((item) => item.fullName.toLowerCase() !== key));
    if (key === mainFullName?.toLowerCase()) return;
    if (extras.length >= MAX_EXTRA_REPOSITORIES) return;
    onChange([...extras, extra]);
  };

  const addExtraUrl = () => {
    if (!extraParsed || isTaken(extraParsed.fullName)) return;
    toggleExtra({ fullName: extraParsed.fullName, url: extraParsed.url });
    setExtraUrl('');
  };

  const selectRepository = (repo: ScmRepositoryListItem) =>
    toggleExtra({
      defaultBranch: repo.defaultBranch ?? undefined,
      fullName: repo.fullName,
      url: repo.htmlUrl,
    });

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal>
        <Button
          icon={<Icon icon={advancedOpen ? ChevronDownIcon : ChevronRightIcon} />}
          size={'small'}
          type={'text'}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {extras.length > 0
            ? t('createFromGithub.advancedWithCount', { count: extras.length })
            : t('createFromGithub.advanced')}
        </Button>
      </Flexbox>
      {advancedOpen && (
        <Flexbox gap={12}>
          <Text fontSize={12} type={'secondary'}>
            {hint ?? t('createFromGithub.extraRepositoriesHint')}
          </Text>
          {extras.length > 0 && (
            <Flexbox gap={6}>
              {extras.map((extra) => (
                <Flexbox
                  horizontal
                  align={'center'}
                  gap={8}
                  key={extra.fullName}
                  style={{
                    border: `1px solid ${cssVar.colorBorderSecondary}`,
                    borderRadius: cssVar.borderRadius,
                    paddingBlock: 6,
                    paddingInline: 12,
                  }}
                >
                  <Github size={14} />
                  <Text ellipsis style={{ flex: 1 }} weight={500}>
                    {extra.fullName}
                  </Text>
                  <ActionIcon
                    icon={XIcon}
                    size={'small'}
                    title={t('createFromGithub.removeRepository')}
                    onClick={() => toggleExtra(extra)}
                  />
                </Flexbox>
              ))}
            </Flexbox>
          )}
          <RepositoryList
            hideGuide
            label={t('createFromGithub.extraRepositoriesLabel')}
            picked={extras.map((item) => item.fullName)}
            onConnect={onConnect}
            onSelect={selectRepository}
          />
          <Flexbox gap={6}>
            <Text fontSize={13} weight={500}>
              {t('createFromGithub.extraUrlLabel')}
            </Text>
            <Flexbox horizontal gap={8}>
              <Input
                aria-invalid={extraUrlInvalid}
                placeholder={t('createFromGithub.urlPlaceholder')}
                style={extraUrlInvalid ? { borderColor: cssVar.colorError } : undefined}
                value={extraUrl}
                onChange={(event) => setExtraUrl(event.target.value)}
                onPressEnter={addExtraUrl}
              />
              <Button
                disabled={
                  !extraParsed ||
                  isTaken(extraParsed.fullName) ||
                  extras.length >= MAX_EXTRA_REPOSITORIES
                }
                onClick={addExtraUrl}
              >
                {t('createFromGithub.addRepository')}
              </Button>
            </Flexbox>
            {extraUrlInvalid && (
              <Text fontSize={12} type={'danger'}>
                {t('createFromGithub.urlInvalid')}
              </Text>
            )}
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default ExtraRepositories;
