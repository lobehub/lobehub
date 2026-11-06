'use client';

import './Section.css';

import { Flexbox } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';

import { FORM_STYLE } from '@/const/layoutTokens';

import SkeletonBar from '../Bar';

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
  label,
  withDesc,
}: {
  control?: SettingsSectionSkeletonControl;
  index: number;
  label?: ReactNode;
  withDesc: boolean;
}) => (
  <div {...stylex.props(styles.row)}>
    {/* Line boxes match the loaded label (14px / 22px) and description (12px / 13px) stack. */}
    <Flexbox gap={4}>
      <Flexbox height={22} justify={'center'}>
        {label ?? <SkeletonBar height={16} width={112 + (index % 2) * 40} />}
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
  /** The group's description line under its title; `true` draws a placeholder bar. */
  desc?: ReactNode;
  /** Right side of the group head, e.g. a placeholder for the real group's action. */
  extra?: ReactNode;
  /** Real row labels by index. Static copy renders as text instead of a bar. */
  labels?: ReactNode[];
  /** Number of form rows, ideally the real group's field count. */
  rows: number;
  /** Real group title. Static copy renders as text instead of a bar. */
  title?: ReactNode;
  /** Width of the group title bar, close to the real title's rendered width. */
  titleWidth?: number;
  /**
   * Render the description line under each label. Hotkey-style forms have none;
   * pass an array to decide per row.
   */
  withDesc?: boolean | boolean[];
}

const DEFAULT_GROUPS: SettingsSectionSkeletonGroup[] = [
  { rows: 2, titleWidth: 104 },
  { rows: 3, titleWidth: 136 },
];

const Group = ({
  control,
  controls,
  desc,
  extra,
  labels,
  rows,
  title,
  titleWidth = 120,
  withDesc = true,
}: SettingsSectionSkeletonGroup) => (
  <Form.Group
    className={'lobe-section-96565f37-group'}
    collapsible={false}
    extra={extra}
    variant={'filled'}
    desc={
      desc === true ? (
        <Flexbox height={19} justify={'center'}>
          <SkeletonBar height={12} width={220} />
        </Flexbox>
      ) : (
        desc || undefined
      )
    }
    title={
      title ?? (
        // The loaded 16px bold title sits in a 25px line box.
        <Flexbox height={25} justify={'center'}>
          <SkeletonBar height={18} width={titleWidth} />
        </Flexbox>
      )
    }
  >
    <Flexbox>
      {Array.from({ length: rows }).map((_, index) => (
        <Flexbox key={index}>
          {index > 0 && <div {...stylex.props(styles.divider)} />}
          <Row
            control={controls?.[index] ?? control}
            index={index}
            label={labels?.[index]}
            withDesc={Array.isArray(withDesc) ? (withDesc[index] ?? true) : withDesc}
          />
        </Flexbox>
      ))}
    </Flexbox>
  </Form.Group>
);

export interface SettingsSectionSkeletonProps {
  /**
   * Gap between groups. Groups of one `<Form itemsType="group">` sit 16px apart;
   * separate forms stacked in the settings container sit 36px apart.
   */
  gap?: number;
  /** One entry per `Form.Group` in the loaded form. Defaults to a 2-row + 3-row pair. */
  groups?: SettingsSectionSkeletonGroup[];
}

/**
 * Loading stand-in for a settings `Form` rendered with `itemsType="group"` and
 * `variant="filled"`: same filled group chrome, one label/description/control row
 * per field, so the real form swaps in without relayout.
 */
const SettingsSectionSkeleton = ({
  gap = 36,
  groups = DEFAULT_GROUPS,
}: SettingsSectionSkeletonProps) => (
  <Flexbox aria-busy data-testid={'settings-section-skeleton'} gap={gap}>
    {groups.map((group, index) => (
      <Group key={index} {...group} />
    ))}
  </Flexbox>
);

export default SettingsSectionSkeleton;

export interface SettingsFormSkeletonItem {
  /** Placeholder for the field's control; defaults to a 32px input filling the control column. */
  control?: { height: number; radius?: number | string; width?: number | string } | ReactNode;
  /** The field's real description (static copy). */
  desc?: ReactNode;
  /** The field's real label (static copy). */
  label: ReactNode;
  /** The loaded field's layout, e.g. `vertical` for a full-width preview. */
  layout?: 'horizontal' | 'vertical';
  /** `FormItem` minWidth of the loaded field; switches pass `undefined` explicitly. */
  minWidth?: number | string;
}

export interface SettingsFormSkeletonGroup {
  desc?: ReactNode;
  extra?: ReactNode;
  items: SettingsFormSkeletonItem[];
  title: ReactNode;
}

/** A 36x22 placeholder in the shape of a `Switch`. */
export const SWITCH_CONTROL = { height: 22, radius: 11, width: 36 };

const isControlSize = (
  control: SettingsFormSkeletonItem['control'],
): control is { height: number; radius?: number | string; width?: number | string } =>
  !!control && typeof control === 'object' && 'height' in (control as object);

/**
 * Loading stand-in that renders the real settings `Form` (filled groups, real
 * titles, labels and descriptions) with placeholder bars in the control slots,
 * so the settled form replaces only the controls. Use it for tabs whose copy is
 * static; `SettingsSectionSkeleton` remains for forms whose rows are not known.
 */
export const SettingsFormSkeleton = ({ groups }: { groups: SettingsFormSkeletonGroup[] }) => {
  const form = useForm();
  const items: FormGroupItem[] = groups.map((group) => ({
    children: group.items.map(({ control, desc, label, layout, ...rest }) => ({
      children: isControlSize(control) ? (
        <SkeletonBar height={control.height} radius={control.radius} width={control.width} />
      ) : (
        (control ?? <SkeletonBar height={32} />)
      ),
      desc,
      label,
      layout,
      ...('minWidth' in rest ? { minWidth: rest.minWidth } : {}),
    })),
    desc: group.desc,
    extra: group.extra,
    title: group.title,
  }));

  return (
    <div aria-busy data-testid={'settings-form-skeleton'}>
      <Form
        collapsible={false}
        form={form}
        items={items}
        itemsType={'group'}
        variant={'filled'}
        {...FORM_STYLE}
      />
    </div>
  );
};
