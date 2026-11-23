import type { GitHubSkillCandidate } from '@lobechat/types';
import { ActionIcon, Button, Checkbox, Flexbox, Icon, Input, Tabs, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { densityTokens } from '@/styles/density.stylex';

import {
  canImportCandidate,
  getGithubSkillChoices,
  toggleGithubSkillPaths,
} from './githubSkillSelection';
import type { useGithubSkillImport } from './useGithubSkillImport';

const styles = stylex.create({
  frame: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    overflow: 'hidden',
  },
  toolbar: {
    backgroundColor: cssVar.colorFillQuaternary,
    paddingBlock: 6,
    paddingInline: densityTokens['--lobe-density-content-gap'],
  },
  list: {
    maxHeight: 'min(40dvh, 360px)',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
  },
  row: {
    borderBlockStartWidth: { 'default': 1, ':first-child': 0 },
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    paddingInline: densityTokens['--lobe-density-content-gap'],
  },
  label: { flexGrow: 1, flexBasis: 0, minWidth: 0, paddingBlock: 9, minHeight: 46 },
  text: { flexGrow: 1, minWidth: 0, whiteSpace: 'normal' },
  choice: { backgroundColor: cssVar.colorFillQuaternary },
  tabs: { marginBlockEnd: 0 },
});

interface CandidateRowProps {
  checked: boolean;
  collapsible: boolean;
  disabled: boolean;
  duplicate: boolean;
  item: GitHubSkillCandidate;
  onChange: (checked: boolean) => void;
}

const CandidateRow = ({
  checked,
  collapsible,
  disabled,
  duplicate,
  item,
  onChange,
}: CandidateRowProps) => {
  const { t } = useTranslation('setting');
  const [expanded, setExpanded] = useState(false);
  const showDetails = !collapsible || expanded;
  const details = t('agentSkillModal.github.skillDetails', { name: item.name });
  return (
    <Flexbox
      horizontal
      align="center"
      gap={4}
      {...stylex.props(styles.row, checked && styles.choice)}
    >
      <Checkbox
        aria-label={item.name + ' ' + (item.path || '/')}
        checked={checked}
        disabled={disabled}
        classNames={{
          text: stylex.props(styles.text).className,
          wrapper: stylex.props(styles.label).className,
        }}
        onChange={onChange}
      >
        <Flexbox as="span" gap={2}>
          <Flexbox horizontal align="center" as="span" gap={6} wrap="wrap">
            <Text strong as="span" wordBreak="break-word">
              {item.name}
            </Text>
            {(!collapsible || item.status !== 'new') && (
              <Tag size="small" style={{ whiteSpace: 'normal' }}>
                {t(`agentSkillModal.github.status.${item.status}`)}
              </Tag>
            )}
          </Flexbox>
          {item.description && (
            <Text
              as="span"
              fontSize={13}
              lineClamp={showDetails ? undefined : 1}
              type="secondary"
              wordBreak="break-word"
            >
              {item.description}
            </Text>
          )}
          {(showDetails || duplicate) && (
            <Text as="span" fontSize={12} type="secondary" wordBreak="break-all">
              {item.path || '/'}
            </Text>
          )}
          {duplicate && (
            <Text as="span" fontSize={12} type="secondary">
              {t('agentSkillModal.github.sameName')}
            </Text>
          )}
        </Flexbox>
      </Checkbox>
      {collapsible && (
        <ActionIcon
          aria-expanded={expanded}
          aria-label={details}
          icon={expanded ? ChevronUp : ChevronDown}
          size={{ blockSize: 44, size: 16 }}
          title={details}
          onClick={() => setExpanded(!expanded)}
        />
      )}
    </Flexbox>
  );
};

export const GithubSkillPicker = ({
  state,
}: {
  state: ReturnType<typeof useGithubSkillImport>;
}) => {
  const { t } = useTranslation('setting');
  const { candidates, canCreate, loading, query, selected, setQuery, setSelected } = state;
  const [selectedOnly, setSelectedOnly] = useState(false);
  const multiple = candidates.length > 1;
  const { bulkPaths, checkedCount, duplicateNames, selectedNames, selectedPaths, visible } =
    getGithubSkillChoices(candidates, selected, query, multiple && selectedOnly);
  const allChecked = bulkPaths.length > 0 && checkedCount === bulkPaths.length;
  const changeSelection = (paths: string[], checked: boolean) =>
    setSelected((current) => toggleGithubSkillPaths(current, paths, checked));

  const list = (
    <Flexbox {...stylex.props(styles.frame)}>
      {multiple && !selectedOnly && (
        <Flexbox horizontal align="center" {...stylex.props(styles.toolbar)}>
          <Checkbox
            checked={allChecked}
            disabled={!canCreate || loading || !bulkPaths.length}
            indeterminate={checkedCount > 0 && !allChecked}
            onChange={(checked) => changeSelection(bulkPaths, checked)}
          >
            {t(
              query.trim()
                ? 'agentSkillModal.github.selectFiltered'
                : 'agentSkillModal.github.selectAvailable',
              { count: bulkPaths.length },
            )}
          </Checkbox>
        </Flexbox>
      )}
      {multiple && selectedOnly && selected.length > 0 && (
        <Flexbox horizontal justify="flex-end" {...stylex.props(styles.toolbar)}>
          <Button
            disabled={loading || !canCreate}
            size="small"
            type="text"
            onClick={() => setSelected([])}
          >
            {t('agentSkillModal.github.clear')}
          </Button>
        </Flexbox>
      )}
      {/* Reserve the collection viewport while filtering so the centered dialog
          keeps the search field and import button in place. */}
      <Flexbox
        key={selectedOnly ? 'selected' : query}
        {...stylex.props(styles.list)}
        height={multiple ? candidates.length * 64 : undefined}
      >
        {visible.map((item) => {
          const checked = selectedPaths.has(item.path);
          const name = item.name.toLowerCase();
          return (
            <CandidateRow
              checked={checked}
              collapsible={multiple}
              duplicate={canImportCandidate(item) && duplicateNames.has(name)}
              item={item}
              key={item.path}
              disabled={
                !canCreate ||
                loading ||
                !canImportCandidate(item) ||
                (!checked && selectedNames.has(name))
              }
              onChange={(next) => changeSelection([item.path], next)}
            />
          );
        })}
        {!visible.length && (
          <Flexbox align="center" gap={6} padding={20}>
            <Text role="status" type="secondary">
              {t(
                selectedOnly
                  ? 'agentSkillModal.github.noneSelected'
                  : 'agentSkillModal.github.noMatch',
              )}
            </Text>
            <Button
              size="small"
              type="text"
              onClick={() => (selectedOnly ? setSelectedOnly(false) : setQuery(''))}
            >
              {t(
                selectedOnly
                  ? 'agentSkillModal.github.browseAll'
                  : 'agentSkillModal.github.clearSearch',
              )}
            </Button>
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );

  if (!multiple) return list;

  return (
    <Tabs
      activeKey={selectedOnly ? 'selected' : 'all'}
      classNames={{ list: stylex.props(styles.tabs).className }}
      size="small"
      variant="square"
      items={[
        {
          key: 'all',
          label: t('agentSkillModal.github.allSkills', { count: candidates.length }),
          children: (
            <Flexbox gap={8}>
              <Input
                allowClear
                aria-label={t('agentSkillModal.github.search')}
                placeholder={t('agentSkillModal.github.search')}
                prefix={<Icon icon={Search} />}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {!selectedOnly && list}
            </Flexbox>
          ),
        },
        {
          key: 'selected',
          label: t('agentSkillModal.github.selectedSkills', { count: selected.length }),
          children: selectedOnly && list,
        },
      ]}
      onChange={(key) => setSelectedOnly(key === 'selected')}
    />
  );
};
