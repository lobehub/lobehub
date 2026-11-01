'use client';

import { Flexbox } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';

import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import SkeletonBar from '../Bar';

const styles = stylex.create({
  action: { flexShrink: 0, marginInlineStart: 'auto' },
  body: {
    display: 'flex',
    flex: '1',
    gap: '12px',
    alignItems: 'center',
    justifyContent: 'space-between',
    minWidth: '0',
  },
  divider: {
    width: '100%',
    height: '1px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  label: {
    flexGrow: { default: 0, [media.md]: 0 },
    flexShrink: { default: 0, [media.md]: 0 },
    flexBasis: { default: '160px', [media.md]: 'auto' },
  },
  row: {
    display: 'flex',
    gap: { default: '24px', [media.md]: '12px' },
    alignItems: { default: 'center', [media.md]: 'stretch' },
    minHeight: '48px',
    paddingBlock: '16px',
    flexDirection: { default: null, [media.md]: 'column' },
  },
});

interface SettingsProfileRowSkeletonProps {
  action?: boolean;
  actionNode?: ReactNode;
  body?: ReactNode;
  bodyWidth?: number;
  height?: number;
  labelWidth?: number;
}

export const SettingsProfileRowSkeleton = ({
  action = true,
  actionNode,
  body,
  bodyWidth = 160,
  height,
  labelWidth = 80,
}: SettingsProfileRowSkeletonProps) => (
  <div
    className={stylex.props(styles.row).className}
    style={height ? { minHeight: height } : undefined}
  >
    <div {...stylex.props(styles.label)}>
      <SkeletonBar height={22} width={labelWidth} />
    </div>
    <div {...stylex.props(styles.body)}>
      {body === undefined ? <SkeletonBar height={22} width={bodyWidth} /> : body}
      {action && (
        <div {...stylex.props(styles.action)}>
          {actionNode ?? <SkeletonBar height={22} width={80} />}
        </div>
      )}
    </div>
  </div>
);

const INTEREST_WIDTHS = [
  128, 188, 152, 148, 148, 164, 164, 188, 148, 100, 120, 136, 144, 144, 120, 128, 104, 104,
];

const InterestsSkeleton = () => (
  <Flexbox horizontal gap={8} style={{ width: '100%' }} wrap={'wrap'}>
    {INTEREST_WIDTHS.map((width, index) => (
      <SkeletonBar height={34} key={index} radius={cssVar.borderRadius} width={width} />
    ))}
  </Flexbox>
);

const SettingsProfileSkeleton = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const email = useUserStore(userProfileSelectors.email);

  return (
    <Form.Group
      aria-busy
      collapsible={false}
      data-testid={'settings-profile-skeleton'}
      title={<SkeletonBar height={18} width={80} />}
      variant={'filled'}
    >
      <Flexbox>
        <SettingsProfileRowSkeleton
          actionNode={<SkeletonBar height={46} radius={cssVar.borderRadius} width={46} />}
          body={null}
          height={78}
        />
        <div {...stylex.props(styles.divider)} />
        <SettingsProfileRowSkeleton action={false} bodyWidth={194} height={68} labelWidth={72} />
        <div {...stylex.props(styles.divider)} />
        <SettingsProfileRowSkeleton action={false} bodyWidth={194} height={68} labelWidth={88} />
        <div {...stylex.props(styles.divider)} />
        <SettingsProfileRowSkeleton
          action={false}
          body={<InterestsSkeleton />}
          height={210}
          labelWidth={64}
        />
        {isLogin && email && (
          <>
            <div {...stylex.props(styles.divider)} />
            <SettingsProfileRowSkeleton bodyWidth={184} height={54} labelWidth={96} />
          </>
        )}
      </Flexbox>
    </Form.Group>
  );
};

export default SettingsProfileSkeleton;
