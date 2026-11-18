import { Block, Button, Flexbox, Tag, Text } from '@lobehub/ui';
import { useState } from 'react';

import type { ReviewView } from '../api';
import { conditionName, describeConditions, groupDifferences, type reviewGrid } from '../review';
import { Pair } from './ShotGrid';

type RestDifference = ReturnType<typeof reviewGrid>['restDifferences'][number];
type Group = ReturnType<typeof groupDifferences<RestDifference>>[number];

const VISIBLE_GROUPS = 3;
const VISIBLE_CONDITIONS = 10;

const DifferenceGroup = ({
  group,
  item,
  showCombo,
}: {
  group: Group;
  item: ReviewView;
  showCombo: boolean;
}) => {
  const [picked, setPicked] = useState(group.entries[0]);
  const [allConditions, setAllConditions] = useState(false);
  const shown = allConditions ? group.entries : group.entries.slice(0, VISIBLE_CONDITIONS);
  const hidden = group.entries.length - shown.length;
  return (
    <Block gap={12} padding={16} variant="outlined">
      <Flexbox gap={4}>
        <Text strong type="danger">
          不一样：{group.summary.join('；')}
        </Text>
        <Text fontSize={12} type="secondary">
          {showCombo ? `${group.label} · ` : ''}
          {group.entries.length} 个条件：
          {describeConditions(group.entries.map((entry) => entry.condition)).join('；')}
        </Text>
      </Flexbox>
      <Flexbox horizontal align="center" gap={6} wrap="wrap">
        {shown.map((entry) => (
          <Tag
            aria-pressed={entry === picked}
            color={entry === picked ? 'processing' : undefined}
            key={entry.condition}
            role="button"
            size="small"
            style={{ cursor: 'pointer' }}
            tabIndex={0}
            onClick={() => setPicked(entry)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setPicked(entry);
              }
            }}
          >
            {conditionName(entry.condition)}
          </Tag>
        ))}
        {hidden > 0 && (
          <Button size="small" type="text" onClick={() => setAllConditions(true)}>
            还有 {hidden} 个
          </Button>
        )}
      </Flexbox>
      <Pair combo={picked.combo} condition={picked.condition} item={item} />
    </Block>
  );
};

export const RestDifferences = ({
  count,
  differences,
  item,
}: {
  count: number;
  differences: RestDifference[];
  item: ReviewView;
}) => {
  const [allGroups, setAllGroups] = useState(false);
  if (!differences.length)
    return (
      <Text fontSize={12} type="secondary">
        还有 {count} 个宽度和交互状态，全部一致。
      </Text>
    );
  const groups = groupDifferences(differences);
  const shown = allGroups ? groups : groups.slice(0, VISIBLE_GROUPS);
  const showCombo = item.combos.length > 1;
  return (
    <Flexbox gap={12}>
      <Text type="secondary">
        其余 {count} 个宽度和交互状态里，{differences.length} 个不一样，归成 {groups.length}{' '}
        种差异。点条件切换截图。
      </Text>
      {shown.map((group) => (
        <DifferenceGroup group={group} item={item} key={group.key} showCombo={showCombo} />
      ))}
      {groups.length > shown.length && (
        <Button block onClick={() => setAllGroups(true)}>
          再显示 {groups.length - shown.length} 种差异
        </Button>
      )}
    </Flexbox>
  );
};
