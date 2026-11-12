'use client';

import { Button, cssVar, Flexbox, Text } from '@lobehub/ui';
import { Form, useForm } from '@lobehub/ui/form';
import { cssVar as sxVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactElement, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';

const styles = stylex.create({
  divided: {
    borderBlockStartColor: sxVar.colorFillSecondary,
    borderBlockStartStyle: 'solid',
    borderBlockStartWidth: 1,
  },
  row: {
    backgroundColor: { 'default': 'transparent', ':hover': sxVar.colorFillQuaternary },
    transition: `background 150ms ${sxVar.motionEaseOut}`,
  },
});

/** How many rows show before the rest fold away. */
export const TOOL_ROWS_VISIBLE = 6;

/** What the caller says about a list: its heading, what it means, and any action beside it. */
export interface ToolGroupMeta {
  desc?: string;
  extra?: ReactNode;
  /** A bare list on the page — heading, rows, add — instead of a card of the settings form. */
  plain?: boolean;
  title: string;
}

interface ToolListGroupProps extends ToolGroupMeta {
  /** How many of the rows are switched on; every row when omitted. */
  activeCount?: number;
  /** The control that adds one more; it closes the list as a row of its own. */
  addControl: ReactNode;
  emptyText: string;
  /** One element per tool or skill, each with its own key. */
  rows: ReactElement[];
  /** How many exist to choose from; shows as "N of M turned on" instead of a bare count. */
  total?: number;
}

const Row = memo<{ children: ReactNode; divided: boolean }>(({ children, divided }) => (
  <Flexbox
    horizontal
    align={'center'}
    paddingBlock={12}
    paddingInline={16}
    {...stylex.props(styles.row, divided && styles.divided)}
  >
    <Flexbox flex={1} style={{ minWidth: 0 }}>
      {children}
    </Flexbox>
  </Flexbox>
));

Row.displayName = 'ToolListRow';

/**
 * One list of tools or skills as a settings group: how many there are beside the heading, one
 * row per item, and "add" as the last row. A long list folds after a few rows so the page stays
 * scannable, and one row opens the rest.
 */
const ToolListGroup = memo<ToolListGroupProps>(
  ({ activeCount, addControl, desc, emptyText, extra, plain, rows, title, total }) => {
    const { t } = useTranslation('setting');
    const form = useForm();
    const [expanded, setExpanded] = useState(false);
    const foldable = rows.length > TOOL_ROWS_VISIBLE;
    const visible = foldable && !expanded ? rows.slice(0, TOOL_ROWS_VISIBLE) : rows;

    const content = (
      <Flexbox>
        {rows.length === 0 ? (
          <Row divided={false}>
            <Text type={'secondary'}>{emptyText}</Text>
          </Row>
        ) : (
          visible.map((row, index) => (
            <Row divided={index > 0} key={row.key ?? index}>
              {row}
            </Row>
          ))
        )}
        {foldable && (
          <Row divided>
            <Flexbox horizontal>
              <Button size={'small'} type={'text'} onClick={() => setExpanded(!expanded)}>
                {expanded
                  ? t('settingAgent.tools.showLess')
                  : t('settingAgent.tools.showAll', { count: rows.length })}
              </Button>
            </Flexbox>
          </Row>
        )}
        <Row divided>
          <Flexbox horizontal>{addControl}</Flexbox>
        </Row>
      </Flexbox>
    );
    const heading = (
      <Flexbox horizontal align={'baseline'} gap={8}>
        {plain ? <Text style={{ fontWeight: 600 }}>{title}</Text> : title}
        <Text fontSize={12} type={'secondary'}>
          {total && total >= rows.length
            ? t('settingAgent.tools.countOfTotal', {
                count: activeCount ?? rows.length,
                total,
              })
            : (activeCount ?? rows.length)}
        </Text>
      </Flexbox>
    );

    if (plain) {
      return (
        <Flexbox gap={8}>
          <Flexbox horizontal align={'center'} justify={'space-between'}>
            {heading}
            {extra}
          </Flexbox>
          <Flexbox style={{ borderBlockStart: `1px solid ${cssVar.colorFillSecondary}` }}>
            {content}
          </Flexbox>
        </Flexbox>
      );
    }

    return (
      <Form
        collapsible={false}
        form={form}
        itemsType={'group'}
        variant={'filled'}
        items={[
          {
            children: content,
            desc,
            extra,
            title: heading,
          },
        ]}
        {...FORM_STYLE}
      />
    );
  },
);

ToolListGroup.displayName = 'ToolListGroup';

export default ToolListGroup;
