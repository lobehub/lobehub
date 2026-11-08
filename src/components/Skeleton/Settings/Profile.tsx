'use client';

import { isDesktop } from '@lobechat/const';
import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { BriefcaseIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { INTEREST_AREAS } from '@/features/Onboarding/config';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import SkeletonBar from '../Bar';
import { useSkeletonText } from './useSkeletonText';

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
  /** The row's real label; static copy renders as text instead of a bar. */
  label?: ReactNode;
  labelWidth?: number;
}

export const SettingsProfileRowSkeleton = ({
  action = true,
  actionNode,
  body,
  bodyWidth = 160,
  height,
  label,
  labelWidth = 80,
}: SettingsProfileRowSkeletonProps) => (
  <div
    className={stylex.props(styles.row).className}
    style={height ? { minHeight: height } : undefined}
  >
    <div {...stylex.props(styles.label)}>
      {label === undefined ? (
        <SkeletonBar height={22} width={labelWidth} />
      ) : (
        <Text strong>{label}</Text>
      )}
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

/**
 * The interest chips are static copy (the onboarding interest areas plus
 * "Other"), so they render as the same outlined chips the row shows; only the
 * user's selection is unknown and stays unhighlighted.
 */
const InterestsSkeleton = () => {
  const { t, ready } = useTranslation('onboarding');
  const chips = [
    ...INTEREST_AREAS.map(({ icon, key }) => ({ icon, key, label: t(`interests.area.${key}`) })),
    { icon: BriefcaseIcon, key: 'other', label: t('interests.area.other') },
  ];

  return (
    <Flexbox horizontal align={'center'} gap={8} style={{ width: '100%' }} wrap={'wrap'}>
      {chips.map(({ icon, key, label }) => (
        <Block horizontal gap={8} key={key} padding={8} variant={'outlined'}>
          <Icon color={cssVar.colorTextSecondary} icon={icon} size={14} />
          {ready ? (
            <Text fontSize={13} weight={500}>
              {label}
            </Text>
          ) : (
            <SkeletonBar height={13} width={56} />
          )}
        </Block>
      ))}
    </Flexbox>
  );
};

/**
 * The profile tab's account group: same title and row labels as the settled
 * group, with placeholders only for the user's values. Rows the settled page
 * shows conditionally (password, email) follow the same conditions.
 */
const SettingsProfileSkeleton = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const email = useUserStore(userProfileSelectors.email);
  const disableEmailPassword = useServerConfigStore(serverConfigSelectors.disableEmailPassword);
  const text = useSkeletonText('auth');
  const label = (key: string, width: number) => {
    const node = text(key, width, 22);
    return typeof node === 'string' ? node : undefined;
  };
  const showPassword = !isDesktop && isLogin && !disableEmailPassword;

  return (
    <Form.Group
      aria-busy
      collapsible={false}
      data-testid={'settings-profile-skeleton'}
      title={text('profile.account', 80, 18)}
      variant={'filled'}
    >
      <Flexbox>
        <SettingsProfileRowSkeleton
          actionNode={<SkeletonBar height={40} radius={'50%'} width={40} />}
          body={null}
          height={72}
          label={label('profile.avatar', 48)}
        />
        <div {...stylex.props(styles.divider)} />
        <SettingsProfileRowSkeleton
          action={false}
          bodyWidth={194}
          height={68}
          label={label('profile.fullName', 72)}
          labelWidth={72}
        />
        <div {...stylex.props(styles.divider)} />
        <SettingsProfileRowSkeleton
          action={false}
          bodyWidth={194}
          height={68}
          label={label('profile.username', 88)}
          labelWidth={88}
        />
        <div {...stylex.props(styles.divider)} />
        <SettingsProfileRowSkeleton
          action={false}
          body={<InterestsSkeleton />}
          label={label('profile.interests', 64)}
          labelWidth={64}
        />
        {showPassword && (
          <>
            <div {...stylex.props(styles.divider)} />
            <SettingsProfileRowSkeleton
              actionNode={<SkeletonBar height={24} radius={cssVar.borderRadius} width={88} />}
              body={null}
              height={56}
              label={label('profile.password', 48)}
              labelWidth={48}
            />
          </>
        )}
        {isLogin && email && (
          <>
            <div {...stylex.props(styles.divider)} />
            <SettingsProfileRowSkeleton
              bodyWidth={184}
              height={54}
              label={label('profile.email', 96)}
              labelWidth={96}
            />
          </>
        )}
        {isLogin && !isDesktop && (
          <>
            <div {...stylex.props(styles.divider)} />
            <SettingsProfileRowSkeleton
              action={false}
              bodyWidth={120}
              label={label('profile.sso.providers', 96)}
              labelWidth={96}
            />
          </>
        )}
      </Flexbox>
    </Form.Group>
  );
};

export default SettingsProfileSkeleton;
