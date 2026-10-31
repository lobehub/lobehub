'use client';

import * as stylex from '@stylexjs/stylex';

import { styles } from '@/features/Apps/style';

import SkeletonBar from './Bar';

const CELL_TITLE_WIDTHS = ['36%', '28%', '44%', '22%'] as const;

const AppsSkeleton = () => (
  <div aria-busy {...stylex.props(styles.page)}>
    <main {...stylex.props(styles.content)}>
      <div {...stylex.props(styles.grid)}>
        <header {...stylex.props(styles.header)}>
          <div {...stylex.props(styles.headerTop)}>
            <SkeletonBar height={12} width={16} />
            <SkeletonBar height={12} width={32} />
          </div>
          <SkeletonBar height={36} width="42%" />
        </header>
        {CELL_TITLE_WIDTHS.map((titleWidth, index) => (
          <article {...stylex.props(styles.cell)} key={titleWidth}>
            <div {...stylex.props(styles.cellMeta)}>
              <SkeletonBar height={12} width={16} />
              <span {...stylex.props(styles.iconBox)} />
            </div>
            <div {...stylex.props(styles.cellBody)}>
              <SkeletonBar height={26} width={titleWidth} />
              <SkeletonBar height={14} width="78%" />
              <SkeletonBar height={14} width="52%" />
            </div>
            <div {...stylex.props(styles.actionSlot)}>
              {index === 3 && <SkeletonBar height={36} width={218} />}
              <SkeletonBar height={32} width={index === 3 ? 186 : 132} />
            </div>
          </article>
        ))}
      </div>
    </main>
  </div>
);

export default AppsSkeleton;
