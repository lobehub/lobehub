'use client';

import { CodeDiff, createModal, Flexbox, type ModalInstance, Select, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t } from 'i18next';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DIFF_OPTIONS, withTrailingNewline } from '@/features/Dashboard/WidgetDetail/diffContent';
import { parseSkillMarkdownFrontmatter } from '@/utils/skillMarkdown';

import type { PlanVersion } from './planVersion';

const styles = stylex.create({
  bar: {
    paddingBlock: '10px',
    paddingInline: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
  body: { overflow: 'auto', flex: '1', minHeight: '0', padding: '16px' },
  root: {
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

interface PlanCompareProps {
  /** Compared with by default; the version before `target` when omitted. */
  base?: number;
  target: number;
  versions: PlanVersion[];
}

const bodyOf = (version?: PlanVersion) =>
  version ? parseSkillMarkdownFrontmatter(version.content).body : '';

/** Two versions of a batch's plan, side by side as a diff, each one pickable. */
const PlanCompare = memo<PlanCompareProps>(({ base, target, versions }) => {
  const { t } = useTranslation('chat');
  const [to, setTo] = useState(target);
  const [from, setFrom] = useState(
    base ?? versions.findLast((version) => version.revision < target)?.revision ?? target,
  );
  const options = versions.map((version) => ({
    label: `v${version.revision}`,
    value: version.revision,
  }));
  const before = bodyOf(versions.find((version) => version.revision === from));
  const after = bodyOf(versions.find((version) => version.revision === to));

  return (
    <div data-plan-compare {...stylex.props(styles.root)}>
      <Flexbox horizontal align={'center'} className={stylex.props(styles.bar).className} gap={8}>
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
      <div {...stylex.props(styles.body)}>
        {before.trim() === after.trim() ? (
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
