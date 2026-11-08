'use client';

import {
  CodeDiff,
  createModal,
  createStaticStyles,
  cssVar,
  Flexbox,
  type ModalInstance,
  Select,
  Text,
} from '@lobehub/ui';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/CircleLoading';
import { DIFF_OPTIONS, withTrailingNewline } from '@/features/Dashboard/WidgetDetail/diffContent';
import { parseSkillMarkdownFrontmatter } from '@/utils/skillMarkdown';

import type { PlanVersion } from './planVersion';
import { useSkillVersion } from './skillVersions';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    padding-block: 10px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorBgLayout};
  `,
  body: css`
    overflow: auto;
    flex: 1;
    min-height: 0;
    padding: 16px;
  `,
  root: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 100%;
    height: 100%;

    background: ${cssVar.colorBgContainer};
  `,
}));

interface PlanCompareProps {
  /** Compared with by default; the version before `target` when omitted. */
  base?: number;
  /** The plan skill whose versions these are; absent for a plan from before skills. */
  skillId?: string;
  target: number;
  versions: PlanVersion[];
}

/** One side of the diff: a skill version read from its archive, else the round's text. */
const useBody = (skillId: string | undefined, versions: PlanVersion[], revision: number) => {
  const { data } = useSkillVersion(skillId, revision);
  const content = data?.content ?? versions.find((v) => v.revision === revision)?.content;
  return content === undefined ? undefined : parseSkillMarkdownFrontmatter(content).body;
};

/** Two versions of a batch's plan, side by side as a diff, each one pickable. */
const PlanCompare = memo<PlanCompareProps>(({ base, skillId, target, versions }) => {
  const { t } = useTranslation('chat');
  const [to, setTo] = useState(target);
  const [from, setFrom] = useState(
    base ?? versions.findLast((version) => version.revision < target)?.revision ?? target,
  );
  const options = versions.map((version) => ({
    label: `v${version.revision}`,
    value: version.revision,
  }));
  const before = useBody(skillId, versions, from);
  const after = useBody(skillId, versions, to);

  return (
    <div data-plan-compare className={styles.root}>
      <Flexbox horizontal align={'center'} className={styles.bar} gap={8}>
        <Select
          options={options}
          size={'small'}
          style={{ width: 88 }}
          value={from}
          onChange={(value) => setFrom(Number(value))}
        />
        <Text type={'secondary'}>→</Text>
        <Select
          options={options}
          size={'small'}
          style={{ width: 88 }}
          value={to}
          onChange={(value) => setTo(Number(value))}
        />
      </Flexbox>
      <div className={styles.body}>
        {before === undefined || after === undefined ? (
          <Loading />
        ) : before.trim() === after.trim() ? (
          <Text type={'secondary'}>{t('goalBatch.planPanel.same', { base: from })}</Text>
        ) : (
          <CodeDiff
            diffOptions={DIFF_OPTIONS}
            language={'markdown'}
            newContent={withTrailingNewline(after)}
            oldContent={withTrailingNewline(before)}
            showHeader={false}
            viewMode={'unified'}
          />
        )}
      </div>
    </div>
  );
});

PlanCompare.displayName = 'GoalPlanCompare';

export const openPlanCompareModal = (props: PlanCompareProps): ModalInstance =>
  createModal({
    content: <PlanCompare {...props} />,
    footer: null,
    styles: {
      content: {
        display: 'flex',
        height: 'min(72vh, 800px)',
        overflow: 'hidden',
        padding: 0,
      },
    },
    title: t('goalBatch.planPanel.compareTitle', { ns: 'chat' }),
    width: 'min(92vw, 960px)',
  });
