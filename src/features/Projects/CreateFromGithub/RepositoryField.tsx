import type { ScmRepositoryListItem } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { ActionIcon, Button, Flexbox, Icon, Input, Popover, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowRightIcon, ChevronDownIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { type ClipboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { densityTokens } from '@/styles/density.stylex';

import { parseGithubRepository } from './githubRepository';
import RepositoryList from './RepositoryList';
import { useScmRepositories } from './useScmRepositories';

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
    paddingInlineStart: densityTokens['--lobe-density-content-gap'],
  },
  popover: {
    width: 'min(400px, calc(100vw - 32px))',
  },
});

const sameRepository = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

interface PasteRepositoryProps {
  /** Above the input; none where the surrounding section already says what it is. */
  label?: string;
  onPick: (repository: PickedRepository) => void;
  picked: PickedRepository[];
}

/**
 * A pasted repository URL. Pasting a whole URL adds it at once; a typed one is
 * added with Enter or the button, so a half-typed path is never picked.
 */
const PasteRepository = ({ label, onPick, picked }: PasteRepositoryProps) => {
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
    <Flexbox gap={6}>
      {label && (
        <Text fontSize={13} weight={500}>
          {label}
        </Text>
      )}
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
  );
};

const toPicked = (repo: ScmRepositoryListItem): PickedRepository => ({
  defaultBranch: repo.defaultBranch ?? undefined,
  fullName: repo.fullName,
  url: repo.htmlUrl,
});

interface RepositoryPickerProps {
  onConnect: () => void;
  onPick: (repository: PickedRepository) => void;
  picked: PickedRepository[];
}

/** The main pick: the list the connected GitHub App can read, or a pasted URL. */
const RepositoryPicker = ({ onConnect, onPick, picked }: RepositoryPickerProps) => {
  const { t } = useTranslation('project');
  return (
    <Flexbox gap={12}>
      <RepositoryList
        picked={picked.map((item) => item.fullName)}
        onConnect={onConnect}
        onSelect={(repo) => onPick(toPicked(repo))}
      />
      <PasteRepository label={t('createFromGithub.urlLabel')} picked={picked} onPick={onPick} />
    </Flexbox>
  );
};

interface GithubRepositoryButtonProps {
  onConnect: () => void;
  onOpenChange: (open: boolean) => void;
  onPick: (repository: PickedRepository) => void;
  open: boolean;
  picked: PickedRepository[];
}

/**
 * The connected list, a click away: a popover once GitHub can list
 * repositories, otherwise the step that would make it — connect, open the
 * settings, or grant access. Nothing while loading or after a failed load; the
 * paste box beside it still works.
 */
const GithubRepositoryButton = ({
  onConnect,
  onOpenChange,
  onPick,
  open,
  picked,
}: GithubRepositoryButtonProps) => {
  const { t } = useTranslation('project');
  const { state } = useScmRepositories();

  if (state === 'loading' || state === 'error') return null;

  if (state !== 'ready')
    return (
      <Button
        icon={<Icon icon={ArrowRightIcon} />}
        iconPosition={'end'}
        size={'small'}
        type={'text'}
        onClick={onConnect}
      >
        {t(
          state === 'disconnected'
            ? 'createFromGithub.connect'
            : state === 'unconfigured'
              ? 'createFromGithub.openIntegrations'
              : 'createFromGithub.manageAccess',
        )}
      </Button>
    );

  return (
    <Popover
      open={open}
      placement={'bottomLeft'}
      trigger={'click'}
      content={
        <div {...stylex.props(styles.popover)}>
          <RepositoryList
            hideGuide
            picked={picked.map((item) => item.fullName)}
            onConnect={onConnect}
            onSelect={(repo) => onPick(toPicked(repo))}
          />
        </div>
      }
      onOpenChange={onOpenChange}
    >
      <Button icon={<Github size={14} />} size={'small'}>
        {t('createFromGithub.chooseFromGithub')}
      </Button>
    </Popover>
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
            <>
              <PasteRepository picked={value} onPick={toggle} />
              <Flexbox horizontal>
                <GithubRepositoryButton
                  open={adding}
                  picked={value}
                  onConnect={onConnect}
                  onOpenChange={setAdding}
                  onPick={toggle}
                />
              </Flexbox>
            </>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default RepositoryField;
