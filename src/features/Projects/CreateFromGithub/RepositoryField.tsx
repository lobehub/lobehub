import type { ScmRepositoryListItem } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { ActionIcon, Button, Flexbox, Icon, Input, Popover, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, XIcon } from 'lucide-react';
import { type ClipboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { parseGithubRepository } from './githubRepository';
import RepositoryList from './RepositoryList';

/** A repository picked for the new project or environment. */
export interface PickedRepository {
  defaultBranch?: string;
  /** `owner/name`. */
  fullName: string;
  url: string;
}

/** One environment checks out at most this many repositories. */
export const MAX_REPOSITORIES = 10;

const styles = stylex.create({
  item: {
    alignItems: 'center',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'flex',
    gap: 8,
    paddingBlock: 6,
    paddingInlineEnd: 6,
    paddingInlineStart: 12,
  },
  popover: {
    width: 'min(400px, calc(100vw - 32px))',
  },
});

const sameRepository = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

interface RepositoryPickerProps {
  onConnect: () => void;
  onPick: (repository: PickedRepository) => void;
  picked: PickedRepository[];
}

/**
 * Where a repository comes from: the list the connected GitHub App can read,
 * or a pasted URL. Pasting a whole URL adds it at once; a typed one is added
 * with Enter or the button, so a half-typed path is never picked.
 */
const RepositoryPicker = ({ onConnect, onPick, picked }: RepositoryPickerProps) => {
  const { t } = useTranslation('project');
  const [url, setUrl] = useState('');
  const parsed = parseGithubRepository(url);
  const invalid = Boolean(url.trim()) && !parsed;
  const taken = (fullName: string) =>
    picked.some((item) => sameRepository(item.fullName, fullName));

  const add = (value = url) => {
    const repository = parseGithubRepository(value);
    if (!repository || taken(repository.fullName)) return false;
    onPick({ fullName: repository.fullName, url: repository.url });
    setUrl('');
    return true;
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (url.trim()) return;
    if (add(event.clipboardData.getData('text').trim())) event.preventDefault();
  };

  return (
    <Flexbox gap={12}>
      <RepositoryList
        picked={picked.map((item) => item.fullName)}
        onConnect={onConnect}
        onSelect={(repo: ScmRepositoryListItem) =>
          onPick({
            defaultBranch: repo.defaultBranch ?? undefined,
            fullName: repo.fullName,
            url: repo.htmlUrl,
          })
        }
      />
      <Flexbox gap={6}>
        <Text fontSize={13} weight={500}>
          {t('createFromGithub.urlLabel')}
        </Text>
        <Flexbox horizontal gap={8}>
          <Input
            aria-invalid={invalid}
            placeholder={t('createFromGithub.urlPlaceholder')}
            style={invalid ? { borderColor: cssVar.colorError } : undefined}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onPaste={handlePaste}
            onPressEnter={() => add()}
          />
          <Button disabled={!parsed || taken(parsed.fullName)} onClick={() => add()}>
            {t('createFromGithub.addRepository')}
          </Button>
        </Flexbox>
        {invalid && (
          <Text fontSize={12} type={'danger'}>
            {t('createFromGithub.urlInvalid')}
          </Text>
        )}
        {parsed && taken(parsed.fullName) && (
          <Text fontSize={12} type={'secondary'}>
            {t('createFromGithub.alreadyAdded')}
          </Text>
        )}
      </Flexbox>
    </Flexbox>
  );
};

interface RepositoryItemProps {
  onRemove: () => void;
  repository: PickedRepository;
}

const RepositoryItem = ({ onRemove, repository }: RepositoryItemProps) => {
  const { t } = useTranslation('project');
  return (
    <div {...stylex.props(styles.item)}>
      <Github size={14} />
      <Text ellipsis style={{ flex: 1 }} weight={500}>
        {repository.fullName}
      </Text>
      <ActionIcon
        icon={XIcon}
        size={'small'}
        title={t('createFromGithub.removeRepository')}
        onClick={onRemove}
      />
    </div>
  );
};

interface RepositoryFieldProps {
  /** Under the field while nothing is picked, e.g. that a repository is optional. */
  emptyHint?: string;
  onChange: (repositories: PickedRepository[]) => void;
  /** Leave the dialog for the GitHub integration settings. */
  onConnect: () => void;
  /** Every picked repository; this field shows the first, the main one. */
  value: PickedRepository[];
}

/**
 * The main repository of a new project or environment. Before the pick the
 * picker is the dialog's main content; after it, one row. More repositories are
 * an advanced setting ({@link AdvancedRepositories}); removing the main one
 * promotes the next.
 */
const RepositoryField = ({ emptyHint, onChange, onConnect, value }: RepositoryFieldProps) => {
  const { t } = useTranslation('project');
  const [main, ...extras] = value;

  if (!main)
    return (
      <Flexbox gap={6}>
        <RepositoryPicker
          picked={value}
          onConnect={onConnect}
          onPick={(repo) => onChange([repo])}
        />
        {emptyHint && (
          <Text fontSize={12} type={'secondary'}>
            {emptyHint}
          </Text>
        )}
      </Flexbox>
    );

  return (
    <Flexbox gap={6}>
      <Text fontSize={13} weight={500}>
        {t('createFromGithub.repositoryTitle')}
      </Text>
      <RepositoryItem repository={main} onRemove={() => onChange(extras)} />
    </Flexbox>
  );
};

interface AdvancedRepositoriesProps {
  /** How several repositories are laid out, in the caller's wording. */
  layoutHint: string;
  onChange: (repositories: PickedRepository[]) => void;
  onConnect: () => void;
  /** Every picked repository, the main one first; this section edits the rest. */
  value: PickedRepository[];
}

/**
 * Advanced settings: repositories checked out beside the main one. Collapsed
 * by default — one repository is what most people need — and added from a
 * popover with the same list and paste box as the main pick.
 */
export const AdvancedRepositories = ({
  layoutHint,
  onChange,
  onConnect,
  value,
}: AdvancedRepositoriesProps) => {
  const { t } = useTranslation('project');
  const [main, ...extras] = value;
  const [open, setOpen] = useState(extras.length > 0);
  const [adding, setAdding] = useState(false);

  /** Picking a repository already there removes it; the main one stays put. */
  const toggle = (repository: PickedRepository) => {
    if (main && sameRepository(main.fullName, repository.fullName)) return;
    if (extras.some((item) => sameRepository(item.fullName, repository.fullName)))
      return onChange(value.filter((item) => !sameRepository(item.fullName, repository.fullName)));
    if (value.length >= MAX_REPOSITORIES) return;
    onChange([...value, repository]);
    setAdding(false);
  };

  if (!main) return null;

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal>
        <Button
          icon={<Icon icon={open ? ChevronDownIcon : ChevronRightIcon} />}
          size={'small'}
          type={'text'}
          onClick={() => setOpen((current) => !current)}
        >
          {extras.length > 0
            ? t('createFromGithub.advancedWithCount', { count: extras.length })
            : t('createFromGithub.advanced')}
        </Button>
      </Flexbox>
      {open && (
        <Flexbox gap={6}>
          <Text fontSize={13} weight={500}>
            {t('createFromGithub.extraRepositoriesLabel')}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {layoutHint}
          </Text>
          {extras.map((repository) => (
            <RepositoryItem
              key={repository.fullName}
              repository={repository}
              onRemove={() => toggle(repository)}
            />
          ))}
          {value.length < MAX_REPOSITORIES && (
            <Flexbox horizontal>
              <Popover
                open={adding}
                placement={'bottomLeft'}
                trigger={'click'}
                content={
                  <div {...stylex.props(styles.popover)}>
                    <RepositoryPicker picked={value} onConnect={onConnect} onPick={toggle} />
                  </div>
                }
                onOpenChange={setAdding}
              >
                <Button icon={<Icon icon={PlusIcon} />} size={'small'}>
                  {t('createFromGithub.addAnother')}
                </Button>
              </Popover>
            </Flexbox>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default RepositoryField;
