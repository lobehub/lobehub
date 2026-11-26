import type { GitHubSkillCandidate, GitHubSkillOutcome } from '@lobechat/types';
import { Button, Checkbox, Empty, Flexbox, Icon, Input, Skeleton, Tag, Text } from '@lobehub/ui';
import { GithubIcon } from '@lobehub/ui/icons';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import BackLink from '../BackLink';
import MarketCard from '../MarketCard';
import GithubAccessRecovery from './GithubAccessRecovery';
import {
  canImportCandidate,
  type GithubSkillImportState,
  useGithubSkillImport,
} from './useGithubSkillImport';

const styles = stylex.create({
  // The card's title row: count, Select all and Add. It never scrolls away,
  // because the list below scrolls inside the card instead of the page.
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingBlockEnd: 12,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: 'min(48vh, 440px)',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    paddingBlock: 10,
    borderBlockStartWidth: { 'default': 1, ':first-child': 0 },
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  text: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
});

/** What became of a picked skill once the batch ran, as a tag. */
const OUTCOME_COLOR: Record<GitHubSkillOutcome['status'], string | undefined> = {
  conflict: 'warning',
  created: 'success',
  failed: 'error',
  forbidden: 'warning',
  unchanged: undefined,
  updated: 'success',
};

const CandidateRow = memo<{
  checked: boolean;
  disabled: boolean;
  item: GitHubSkillCandidate;
  onChange: (checked: boolean) => void;
  outcome?: GitHubSkillOutcome['status'];
}>(({ checked, disabled, item, onChange, outcome }) => {
  const { t } = useTranslation('setting');
  const importable = canImportCandidate(item) && !outcome;
  return (
    <div {...stylex.props(styles.row)}>
      <Checkbox
        aria-label={item.name}
        checked={importable && checked}
        disabled={disabled || !importable}
        onChange={onChange}
      />
      <span {...stylex.props(styles.text)}>
        <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
          <Text weight={500}>{item.name}</Text>
          {outcome ? (
            <Tag color={OUTCOME_COLOR[outcome]} size={'small'}>
              {t(`market.skills.github.outcome.${outcome}`)}
            </Tag>
          ) : (
            item.status !== 'new' && (
              <Tag color={item.status === 'update' ? 'processing' : undefined} size={'small'}>
                {t(`market.skills.github.status.${item.status}`)}
              </Tag>
            )
          )}
        </Flexbox>
        {item.description && (
          <Text fontSize={12} lineClamp={2} title={item.description} type={'secondary'}>
            {item.description}
          </Text>
        )}
        <Text fontSize={12} style={{ wordBreak: 'break-all' }} type={'secondary'}>
          {item.path || '/'}
        </Text>
      </span>
    </div>
  );
});

CandidateRow.displayName = 'MarketGithubCandidateRow';

/** The skills one scan found, with the picks and the install button. */
const ScanResult = memo<{ state: GithubSkillImportState }>(({ state }) => {
  const { t } = useTranslation('setting');
  const { candidates, install, loading, pending, results, scan, selected, setSelected, source } =
    state;
  const outcomes = new Map(results.map((item) => [item.path, item.status]));
  const open = candidates.filter((item) => canImportCandidate(item) && !outcomes.has(item.path));
  const picked = open.filter((item) => selected.includes(item.path));
  const updates = picked.filter((item) => item.status === 'update').length;
  const all = open.length > 0 && picked.length === open.length;
  const repo = source ? `${source.owner}/${source.repo}` : '';

  if (!scan) return null;
  if (candidates.length === 0)
    return (
      <MarketCard>
        <Empty description={t('market.skills.github.none', { repo })} />
      </MarketCard>
    );

  return (
    <MarketCard gap={4}>
      <div {...stylex.props(styles.header)}>
        <Text weight={600}>
          {t('market.skills.github.found', { count: candidates.length, repo })}
        </Text>
        {open.length > 0 && (
          <Flexbox horizontal align={'center'} gap={12}>
            {open.length > 1 && (
              <Checkbox
                checked={all}
                disabled={loading}
                indeterminate={picked.length > 0 && !all}
                onChange={(checked) => setSelected(checked ? open.map((item) => item.path) : [])}
              >
                {t('market.skills.github.selectAll')}
              </Checkbox>
            )}
            <Button
              disabled={!picked.length}
              loading={pending === 'import' || pending === 'refresh'}
              type={'primary'}
              onClick={() => void install(picked.map((item) => item.path))}
            >
              {updates === picked.length && updates > 0
                ? t('market.skills.github.update', { count: updates })
                : t('market.skills.github.add', { count: picked.length })}
            </Button>
          </Flexbox>
        )}
      </div>
      <div {...stylex.props(styles.list)}>
        {candidates.map((item) => (
          <CandidateRow
            checked={selected.includes(item.path)}
            disabled={loading}
            item={item}
            key={item.path}
            outcome={outcomes.get(item.path)}
            onChange={(checked) =>
              setSelected((prev) =>
                checked ? [...prev, item.path] : prev.filter((path) => path !== item.path),
              )
            }
          />
        ))}
      </div>
    </MarketCard>
  );
});

ScanResult.displayName = 'MarketGithubScanResult';

/**
 * Add skills from a GitHub repository: the address (from search, from an
 * installed skill, or typed here) is scanned for every `SKILL.md` — at the
 * root, under `skills/`, `.claude/skills/`, plugin folders, anywhere — and the
 * picked ones install at the scanned commit. Installed ones show as
 * up to date or with an update to take. A private repository offers to
 * connect GitHub or save a token in the Vault, then scans again.
 */
const GithubImportPage = memo<{ initialUrl: string; onBack: () => void }>(
  ({ initialUrl, onBack }) => {
    const { t } = useTranslation('setting');
    const state = useGithubSkillImport(initialUrl);
    const { discover, failure, input, loading, pending, scan, setInput, source } = state;
    const invalid = !!input.trim() && !source;

    return (
      <Flexbox gap={20}>
        <Flexbox gap={12}>
          <BackLink onClick={onBack} />
          <Flexbox gap={4}>
            <Text fontSize={20} weight={600}>
              {t('market.skills.github.title')}
            </Text>
            <Text type={'secondary'}>{t('market.skills.github.desc')}</Text>
          </Flexbox>
        </Flexbox>
        <Flexbox gap={6}>
          <Flexbox horizontal gap={8}>
            <Input
              autoFocus={!initialUrl}
              placeholder={t('market.skills.github.placeholder')}
              prefix={<Icon icon={GithubIcon} />}
              value={input}
              variant={'filled'}
              onChange={(event) => setInput(event.target.value)}
              onPressEnter={() => void discover()}
            />
            <Button
              disabled={!source}
              loading={pending === 'find'}
              type={scan ? 'fill' : 'primary'}
              onClick={() => void discover()}
            >
              {t('market.skills.github.find')}
            </Button>
          </Flexbox>
          {invalid && (
            <Text fontSize={12} type={'danger'}>
              {t('market.skills.github.invalid')}
            </Text>
          )}
        </Flexbox>
        {failure?.recovery ? (
          <GithubAccessRecovery recovery={failure.recovery} onResolved={() => void discover()} />
        ) : (
          failure && (
            <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
              <Text type={'danger'}>
                {t(`market.skills.github.failed.${failure.stage}`)}
                {failure.details ? ` ${failure.details}` : ''}
              </Text>
              <Button
                loading={loading}
                type={'fill'}
                onClick={() =>
                  void (failure.stage === 'refresh' ? state.refreshLibrary() : discover())
                }
              >
                {t('market.skills.github.retry')}
              </Button>
            </Flexbox>
          )
        )}
        {pending === 'find' ? (
          <MarketCard>
            <Skeleton.Text rows={4} />
          </MarketCard>
        ) : (
          <ScanResult state={state} />
        )}
      </Flexbox>
    );
  },
);

GithubImportPage.displayName = 'MarketGithubImportPage';

export default GithubImportPage;
