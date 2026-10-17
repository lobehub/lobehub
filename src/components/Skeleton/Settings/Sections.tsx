'use client';

import { createStaticStyles, cssVar, Flexbox } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import type { ComponentType, ReactNode } from 'react';

import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from '../Bar';

/** Shared head options of every section rendered as a filled `Form.Group`. */
interface GroupHeadOptions {
  /** The real group shows a description line under its title. */
  desc?: boolean;
  /** The real group shows an action button on the right of its head. */
  extra?: boolean;
  titleWidth?: number;
}

/**
 * One block of a settings page. Every variant except `cards` (ungrouped) and
 * `banner` is a filled `Form.Group`, so the skeleton reuses the real group
 * chrome and only the contents are placeholders.
 */
export type SettingsSectionSkeleton =
  | (GroupHeadOptions & {
      /** One full-width input with a trailing button instead of labelled rows. */
      field?: boolean;
      /** Label + description on the left, control on the right. */
      rows?: number;
      variant: 'form';
    })
  | (GroupHeadOptions & {
      /** Table rows below the header row. */
      rows?: number;
      /** A filter / search bar above the table. */
      toolbar?: boolean;
      /** A tab strip above the table. */
      tabs?: boolean;
      variant: 'table';
    })
  | (GroupHeadOptions & {
      columns?: number;
      /** Height of one tile; defaults to a two-line tile. */
      tileHeight?: number;
      /** Compact label + value tiles laid out edge to edge. */
      tiles?: number;
      variant: 'tiles';
    })
  | (GroupHeadOptions & {
      /** A media block on the right of the figures, e.g. an illustrated card. */
      aside?: { height: number; width: number };
      /** A second label/value pair plus a divider and a link row below the figure. */
      secondary?: boolean;
      /** Label, one large figure and a caption line. */
      variant: 'summary';
    })
  | (GroupHeadOptions & {
      /** Icon + title header followed by a checklist. */
      lines?: number;
      variant: 'detail';
    })
  | (GroupHeadOptions & {
      cards?: number;
      columns?: number;
      /** Key/value lines, a note block and a total + action row below the grid. */
      footer?: boolean;
      gap?: number;
      /** Wrap the grid in a titled filled group; otherwise the cards stand alone. */
      grouped?: boolean;
      /** `large` cards carry icon, title, figure, button and a checklist. */
      size?: 'large' | 'small';
      /** A centred segmented control above the grid, and its gap to the grid. */
      toolbar?: { gap: number; height: number; width: number };
      variant: 'cards';
    })
  | {
      /** An outlined block with an avatar and two text lines. */
      variant: 'banner';
    };

export interface SettingsSectionsShape {
  /** Vertical gap between sections, as set by the real page's stack. */
  gap?: number;
  sections: SettingsSectionSkeleton[];
  /** The page draws its own large title + divider above the sections. */
  title?: boolean;
}

/**
 * Where the skeleton sits when the route has no layout chrome around it
 * (`chrome='page'`). Under `chrome='body'` the host layout already draws its
 * header and padded container, so only the sections render.
 *
 * - `header`: navigation header above a padded, centred 1024px container.
 * - `container`: padded, centred container only (the page draws its own title).
 * - `none`: the sections alone.
 */
export type SettingsSectionsFrame = 'container' | 'header' | 'none';

const styles = createStaticStyles(({ css }) => ({
  banner: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  card: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  divider: css`
    width: 100%;
    height: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  flush: css`
    overflow: hidden;

    [data-form-group-body] {
      padding: 0;
    }
  `,
  grid: css`
    display: grid;
  `,
  tile: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const widthAt = (index: number, widths: number[]) => widths[index % widths.length];

/** Matches the 16px/25px title line of a filled group head. */
const GroupTitle = ({ width = 104 }: { width?: number }) => (
  <Flexbox height={25} justify={'center'}>
    <SkeletonBar height={16} width={width} />
  </Flexbox>
);

/** Matches the 12px/19px description line of a group head. */
const GroupDesc = () => (
  <Flexbox height={19} justify={'center'}>
    <SkeletonBar height={12} width={220} />
  </Flexbox>
);

const Group = ({
  children,
  desc,
  extra,
  flush,
  titleWidth,
}: GroupHeadOptions & { children: ReactNode; flush?: boolean }) => (
  <Form.Group
    className={flush ? styles.flush : undefined}
    collapsible={false}
    desc={desc ? <GroupDesc /> : undefined}
    extra={extra ? <SkeletonBar height={32} width={120} /> : undefined}
    title={<GroupTitle width={titleWidth} />}
    variant={'filled'}
  >
    {children}
  </Form.Group>
);

const FormRows = ({ rows }: { rows: number }) => (
  <Flexbox>
    {Array.from({ length: rows }).map((_, index) => (
      <Flexbox key={index}>
        {index > 0 && <div className={styles.divider} />}
        <Flexbox
          horizontal
          align={'center'}
          gap={24}
          justify={'space-between'}
          style={{ minHeight: 64, paddingBlock: 16 }}
        >
          <Flexbox gap={8}>
            <SkeletonBar height={16} width={widthAt(index, [112, 152])} />
            <SkeletonBar height={12} width={widthAt(index, [224, 260, 296])} />
          </Flexbox>
          <SkeletonBar height={32} width={widthAt(index, [88, 152])} />
        </Flexbox>
      </Flexbox>
    ))}
  </Flexbox>
);

const TABLE_COLUMNS = [18, 12, 14, 16, 12];

const TableBody = ({
  rows,
  tabs,
  toolbar,
}: {
  rows: number;
  tabs?: boolean;
  toolbar?: boolean;
}) => (
  <Flexbox>
    {tabs && (
      <Flexbox horizontal align={'center'} gap={24} height={48} paddingInline={16}>
        <SkeletonBar height={14} width={64} />
        <SkeletonBar height={14} width={72} />
        <SkeletonBar height={14} width={64} />
      </Flexbox>
    )}
    {toolbar && (
      <Flexbox horizontal align={'center'} gap={8} height={61} paddingInline={16}>
        <Flexbox flex={2}>
          <SkeletonBar height={32} />
        </Flexbox>
        <Flexbox flex={1}>
          <SkeletonBar height={32} />
        </Flexbox>
        <Flexbox flex={1.5}>
          <SkeletonBar height={32} />
        </Flexbox>
        <SkeletonBar height={32} width={72} />
      </Flexbox>
    )}
    <Flexbox horizontal align={'center'} gap={24} height={40} paddingInline={16}>
      {TABLE_COLUMNS.map((flex, index) => (
        <Flexbox flex={flex} key={index}>
          <SkeletonBar height={12} width={'48%'} />
        </Flexbox>
      ))}
    </Flexbox>
    {Array.from({ length: rows }).map((_, row) => (
      <Flexbox key={row}>
        <div className={styles.divider} />
        <Flexbox horizontal align={'center'} gap={24} height={52} paddingInline={16}>
          {TABLE_COLUMNS.map((flex, index) => (
            <Flexbox flex={flex} key={index}>
              <SkeletonBar height={14} width={`${56 + ((row + index) % 3) * 14}%`} />
            </Flexbox>
          ))}
        </Flexbox>
      </Flexbox>
    ))}
  </Flexbox>
);

const Field = () => (
  <Flexbox horizontal align={'center'} gap={8}>
    <Flexbox flex={1}>
      <SkeletonBar height={38} />
    </Flexbox>
    <SkeletonBar height={38} width={88} />
  </Flexbox>
);

const Tiles = ({
  columns,
  tileHeight,
  tiles,
}: {
  columns: number;
  tileHeight: number;
  tiles: number;
}) => (
  <div
    className={styles.grid}
    style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
  >
    {Array.from({ length: tiles }).map((_, index) => (
      <Flexbox
        horizontal
        align={'center'}
        className={styles.tile}
        gap={12}
        height={tileHeight}
        justify={'space-between'}
        key={index}
        paddingInline={12}
      >
        <Flexbox gap={8}>
          <SkeletonBar height={14} width={widthAt(index, [56, 72, 64])} />
          <SkeletonBar height={14} width={widthAt(index, [160, 96, 136])} />
        </Flexbox>
        <SkeletonBar height={26} radius={'50%'} width={26} />
      </Flexbox>
    ))}
  </div>
);

const Summary = ({
  aside,
  secondary,
}: {
  aside?: { height: number; width: number };
  secondary?: boolean;
}) => {
  const figures = secondary ? (
    <Flexbox flex={1} gap={16}>
      <SkeletonBar height={16} width={96} />
      <SkeletonBar height={28} width={48} />
      <SkeletonBar height={16} width={72} />
      <SkeletonBar height={20} width={'56%'} />
      <div className={styles.divider} />
      <SkeletonBar height={20} width={200} />
    </Flexbox>
  ) : (
    <Flexbox flex={1} gap={19}>
      <SkeletonBar height={16} width={120} />
      <SkeletonBar height={36} width={200} />
      <SkeletonBar height={12} width={'42%'} />
    </Flexbox>
  );

  if (!aside) return figures;
  return (
    <Flexbox horizontal gap={16}>
      {figures}
      <SkeletonBar height={aside.height} radius={cssVar.borderRadiusLG} width={aside.width} />
    </Flexbox>
  );
};

const Checklist = ({ lines }: { lines: number }) => (
  <Flexbox>
    {Array.from({ length: lines }).map((_, index) => (
      <Flexbox horizontal align={'center'} gap={10} height={25} key={index}>
        <SkeletonBar height={12} width={12} />
        <SkeletonBar height={14} width={widthAt(index, [180, 132, 220, 156])} />
      </Flexbox>
    ))}
  </Flexbox>
);

const Detail = ({ lines }: { lines: number }) => (
  <Flexbox gap={19}>
    <Flexbox horizontal align={'center'} gap={12}>
      <SkeletonBar height={40} radius={cssVar.borderRadiusLG} width={40} />
      <Flexbox gap={6}>
        <SkeletonBar height={16} width={96} />
        <SkeletonBar height={12} width={200} />
      </Flexbox>
    </Flexbox>
    <div className={styles.divider} />
    <Checklist lines={lines} />
  </Flexbox>
);

const Card = ({ size }: { size: 'large' | 'small' }) =>
  size === 'large' ? (
    <Flexbox className={styles.card} gap={16} height={720} padding={16}>
      <SkeletonBar height={36} radius={cssVar.borderRadiusLG} width={36} />
      <Flexbox gap={10}>
        <SkeletonBar height={18} width={72} />
        <SkeletonBar height={14} width={'72%'} />
      </Flexbox>
      {/* Large figure then the full-width action, spaced like the loaded card. */}
      <Flexbox gap={19} paddingBlock={'20px 15px'}>
        <SkeletonBar height={32} width={128} />
        <SkeletonBar height={32} />
      </Flexbox>
      <Checklist lines={12} />
    </Flexbox>
  ) : (
    <Flexbox className={styles.card} gap={8} height={65} justify={'center'} paddingInline={12}>
      <SkeletonBar height={18} width={48} />
      <SkeletonBar height={12} width={64} />
    </Flexbox>
  );

const CardsFooter = () => (
  <Flexbox gap={16}>
    <Flexbox>
      {[96, 72, 64].map((width, index) => (
        <Flexbox horizontal align={'center'} height={25} justify={'space-between'} key={index}>
          <SkeletonBar height={12} width={width} />
          <SkeletonBar height={12} width={56} />
        </Flexbox>
      ))}
    </Flexbox>
    <SkeletonBar height={56} radius={cssVar.borderRadiusLG} />
    <div className={styles.divider} />
    <Flexbox horizontal align={'center'} justify={'space-between'}>
      <SkeletonBar height={28} width={120} />
      <SkeletonBar height={38} width={128} />
    </Flexbox>
  </Flexbox>
);

const CardGrid = ({
  cards,
  columns,
  gap,
  size,
}: {
  cards: number;
  columns: number;
  gap: number;
  size: 'large' | 'small';
}) => (
  <div
    className={styles.grid}
    style={{ gap, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
  >
    {Array.from({ length: cards }).map((_, index) => (
      <Card key={index} size={size} />
    ))}
  </div>
);

const Section = ({ section }: { section: SettingsSectionSkeleton }) => {
  switch (section.variant) {
    case 'banner': {
      return (
        <Flexbox horizontal align={'center'} className={styles.banner} gap={16} padding={18}>
          <SkeletonBar height={48} radius={'50%'} width={48} />
          <Flexbox gap={10}>
            <SkeletonBar height={18} width={240} />
            <SkeletonBar height={12} width={360} />
          </Flexbox>
        </Flexbox>
      );
    }
    case 'cards': {
      const {
        cards = 3,
        columns = 3,
        footer,
        gap = 12,
        grouped,
        size = 'large',
        toolbar,
      } = section;
      const grid = <CardGrid cards={cards} columns={columns} gap={gap} size={size} />;
      if (grouped)
        return (
          <Group {...section}>
            <Flexbox gap={16}>
              {grid}
              {footer && <CardsFooter />}
            </Flexbox>
          </Group>
        );
      return (
        <Flexbox gap={toolbar?.gap ?? 0}>
          {toolbar && (
            <Flexbox align={'center'}>
              <SkeletonBar
                height={toolbar.height}
                radius={cssVar.borderRadiusLG}
                width={toolbar.width}
              />
            </Flexbox>
          )}
          {grid}
        </Flexbox>
      );
    }
    case 'detail': {
      return (
        <Group {...section}>
          <Detail lines={section.lines ?? 8} />
        </Group>
      );
    }
    case 'form': {
      return (
        <Group {...section}>
          {section.field ? <Field /> : <FormRows rows={section.rows ?? 2} />}
        </Group>
      );
    }
    case 'summary': {
      return (
        <Group {...section}>
          <Summary aside={section.aside} secondary={section.secondary} />
        </Group>
      );
    }
    case 'table': {
      return (
        <Group {...section} flush>
          <TableBody rows={section.rows ?? 3} tabs={section.tabs} toolbar={section.toolbar} />
        </Group>
      );
    }
    case 'tiles': {
      return (
        <Group {...section} flush>
          <Tiles
            columns={section.columns ?? 2}
            tileHeight={section.tileHeight ?? 63}
            tiles={section.tiles ?? 4}
          />
        </Group>
      );
    }
  }
};

/** Large page title + divider, matching a settings page that renders its own heading. */
const PageTitle = () => (
  <Flexbox gap={24} style={{ paddingTop: 12 }}>
    <Flexbox height={38} justify={'center'}>
      <SkeletonBar height={28} width={96} />
    </Flexbox>
    <div className={styles.divider} />
  </Flexbox>
);

/**
 * The sections of a settings page without any surrounding chrome. Use it
 * directly where a layout already draws the header and padded container.
 */
export const SettingsSectionsBody = ({ shape }: { shape: SettingsSectionsShape }) => (
  <Flexbox aria-busy data-testid={'settings-sections-skeleton'} gap={shape.gap ?? 36}>
    {shape.title && <PageTitle />}
    {shape.sections.map((section, index) => (
      <Section key={index} section={section} />
    ))}
  </Flexbox>
);

/**
 * Route skeleton for a settings-style page made of stacked filled groups.
 * Under `chrome='page'` it draws the frame named by `frame`; under
 * `chrome='body'` the host layout owns that frame, so only the sections render.
 */
export const SettingsSectionsSkeleton = ({
  chrome = 'page',
  frame = 'header',
  shape,
}: RouteSkeletonProps & { frame?: SettingsSectionsFrame; shape: SettingsSectionsShape }) => {
  const body = <SettingsSectionsBody shape={shape} />;
  if (chrome === 'body' || frame === 'none') return body;

  return (
    <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
      {frame === 'header' && (
        <NavHeader styles={{ center: { alignItems: 'center' } }}>
          <SkeletonBar height={16} width={88} />
        </NavHeader>
      )}
      <SettingContainer maxWidth={1024} paddingBlock={'24px 128px'} paddingInline={24}>
        {body}
      </SettingContainer>
    </Flexbox>
  );
};

/**
 * Binds a shape and frame into a route `Skeleton` component. Call it once per
 * route definition (module scope) so the component identity stays stable.
 */
export const createSettingsSectionsSkeleton = (
  shape: SettingsSectionsShape,
  frame: SettingsSectionsFrame = 'header',
): ComponentType<RouteSkeletonProps> => {
  const Component = ({ chrome }: RouteSkeletonProps) => (
    <SettingsSectionsSkeleton chrome={chrome} frame={frame} shape={shape} />
  );
  Component.displayName = `SettingsSectionsSkeleton(${frame})`;
  return Component;
};

export default SettingsSectionsSkeleton;
