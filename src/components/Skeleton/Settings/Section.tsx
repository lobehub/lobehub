'use client';

import { Flexbox } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import SkeletonBar from '../Bar';
import moduleStyles from './Section.module.css';

const styles = stylex.create({
  divider: {
    width: '100%',
    height: '1px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  row: {
    display: 'flex',
    gap: '24px',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: '64px',
    paddingBlock: '16px',
  },
});

export interface SettingsSectionSkeletonControl {
  height: number;
  width: number;
}

const Row = ({
  control,
  index,
  withDesc,
}: {
  control?: SettingsSectionSkeletonControl;
  index: number;
  withDesc: boolean;
}) => (
  <div {...stylex.props(styles.row)}>
    {/* Line boxes match the loaded label (14px / 22px) and description (12px / 13px) stack. */}
    <Flexbox gap={4}>
      <Flexbox height={22} justify={'center'}>
        <SkeletonBar height={16} width={112 + (index % 2) * 40} />
      </Flexbox>
      {withDesc && (
        <Flexbox height={13} justify={'center'}>
          <SkeletonBar height={12} width={224 + (index % 3) * 36} />
        </Flexbox>
      )}
    </Flexbox>
    <SkeletonBar
      height={control?.height ?? 32}
      radius={control ? cssVar.borderRadiusLG : undefined}
      width={control?.width ?? (index % 2 ? 152 : 88)}
    />
  </div>
);

export interface SettingsSectionSkeletonGroup {
  /** Control size for every row without an entry in `controls` (default 32px tall). */
  control?: SettingsSectionSkeletonControl;
  /**
   * Control size overrides keyed by row index, for fields taller than a 32px input
   * (e.g. an image picker). The row grows with the control, as the loaded row does.
   */
  controls?: Record<number, SettingsSectionSkeletonControl>;
  /** Number of form rows, ideally the real group's field count. */
  rows: number;
  /** Width of the group title bar, close to the real title's rendered width. */
  titleWidth?: number;
  /** Render the description line under each label. Hotkey-style forms have none. */
  withDesc?: boolean;
}

const DEFAULT_GROUPS: SettingsSectionSkeletonGroup[] = [
  { rows: 2, titleWidth: 104 },
  { rows: 3, titleWidth: 136 },
];

const Group = ({
  control,
  controls,
  rows,
  titleWidth = 120,
  withDesc = true,
}: SettingsSectionSkeletonGroup) => (
  <Form.Group
    className={moduleStyles.group}
    collapsible={false}
    variant={'filled'}
    title={
      // The loaded 16px bold title sits in a 25px line box.
      <Flexbox height={25} justify={'center'}>
        <SkeletonBar height={18} width={titleWidth} />
      </Flexbox>
    }
  >
    <Flexbox>
      {Array.from({ length: rows }).map((_, index) => (
        <Flexbox key={index}>
          {index > 0 && <div {...stylex.props(styles.divider)} />}
          <Row control={controls?.[index] ?? control} index={index} withDesc={withDesc} />
        </Flexbox>
      ))}
    </Flexbox>
  </Form.Group>
);

export interface SettingsSectionSkeletonProps {
  /** One entry per `Form.Group` in the loaded form. Defaults to a 2-row + 3-row pair. */
  groups?: SettingsSectionSkeletonGroup[];
}

/**
 * Loading stand-in for a settings `Form` rendered with `itemsType="group"` and
 * `variant="filled"`: same filled group chrome, one label/description/control row
 * per field, so the real form swaps in without relayout.
 */
const SettingsSectionSkeleton = ({ groups = DEFAULT_GROUPS }: SettingsSectionSkeletonProps) => (
  <Flexbox aria-busy data-testid={'settings-section-skeleton'} gap={36}>
    {groups.map((group, index) => (
      <Group key={index} {...group} />
    ))}
  </Flexbox>
);

export default SettingsSectionSkeleton;
