'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Fragment, memo } from 'react';

import Cell from '@/components/Cell';
import Divider from '@/components/Cell/Divider';

import { useCategory } from './useCategory';

const styles = stylex.create({
  groupTitle: {
    paddingBlockStart: '16px',
    paddingBlockEnd: '4px',
    paddingInline: '16px',
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
});

const Category = memo(() => {
  const groups = useCategory();

  return (
    <>
      {groups.map((group, groupIndex) => (
        <Fragment key={group.key}>
          {groupIndex > 0 && <Divider />}
          <div {...stylex.props(styles.groupTitle)}>{group.title}</div>
          {group.items.map(({ key, ...item }) => (
            <Cell key={key} {...item} />
          ))}
        </Fragment>
      ))}
    </>
  );
});

export default Category;
