'use client';

import { createStaticStyles, cssVar } from 'antd-style';
import { Fragment, memo } from 'react';

import Cell from '@/components/Cell';
import Divider from '@/components/Cell/Divider';

import { useCategory } from './useCategory';

const styles = createStaticStyles(({ css }) => ({
  groupTitle: css`
    padding-block: 16px 4px;
    padding-inline: 16px;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
    text-transform: uppercase;
    letter-spacing: 0.5px;
  `,
}));

const Category = memo(() => {
  const groups = useCategory();

  return (
    <>
      {groups.map((group, groupIndex) => (
        <Fragment key={group.key}>
          {groupIndex > 0 && <Divider />}
          <div className={styles.groupTitle}>{group.title}</div>
          {group.items.map(({ key, ...item }) => (
            <Cell key={key} {...item} />
          ))}
        </Fragment>
      ))}
    </>
  );
});

export default Category;
