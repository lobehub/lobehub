'use client';

import { styles } from '@/features/Apps/style';

import SkeletonBar from './Bar';

const CELL_TITLE_WIDTHS = ['36%', '28%', '44%', '22%'] as const;

const AppsSkeleton = () => (
  <div aria-busy className={styles.page}>
    <main className={styles.content}>
      <div className={styles.grid}>
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <SkeletonBar height={12} width={16} />
            <SkeletonBar height={12} width={32} />
          </div>
          <SkeletonBar height={36} width="42%" />
        </header>
        {CELL_TITLE_WIDTHS.map((titleWidth, index) => (
          <article className={styles.cell} key={titleWidth}>
            <div className={styles.cellMeta}>
              <SkeletonBar height={12} width={16} />
              <span className={styles.iconBox} />
            </div>
            <div className={styles.cellBody}>
              <SkeletonBar height={26} width={titleWidth} />
              <SkeletonBar height={14} width="78%" />
              <SkeletonBar height={14} width="52%" />
            </div>
            <div className={styles.actionSlot}>
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
