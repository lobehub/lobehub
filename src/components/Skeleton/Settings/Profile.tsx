'use client';

import { Flexbox, FormGroup } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { type ReactNode } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useToolStore } from '@/store/tool';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import SkeletonBar from '../Bar';

const styles = createStaticStyles(({ css, responsive }) => ({
  action: css`
    flex-shrink: 0;
    margin-inline-start: auto;
  `,
  body: css`
    display: flex;
    flex: 1;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    min-width: 0;
  `,
  divider: css`
    width: 100%;
    height: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  label: css`
    flex: 0 0 160px;

    ${responsive.md} {
      flex: 0 0 auto;
    }
  `,
  row: css`
    display: flex;
    gap: 24px;
    align-items: center;

    min-height: 48px;
    padding-block: 16px;

    ${responsive.md} {
      flex-direction: column;
      gap: 12px;
      align-items: stretch;
    }
  `,
}));

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
  <div className={styles.row} style={height ? { minHeight: height } : undefined}>
    <div className={styles.label}>
      <SkeletonBar height={22} width={labelWidth} />
    </div>
    <div className={styles.body}>
      {body === undefined ? <SkeletonBar height={22} width={bodyWidth} /> : body}
      {action && (
        <div className={styles.action}>{actionNode ?? <SkeletonBar height={22} width={80} />}</div>
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
  const enableComposio = useServerConfigStore(serverConfigSelectors.enableComposio);
  const [hasConnectedServers, isServersInit] = useToolStore((state) => [
    state.composioServers.some((server) => server.status === ComposioServerStatus.ACTIVE),
    state.isComposioServersInit,
  ]);

  return (
    <FormGroup
      aria-busy
      collapsible={false}
      data-testid={'settings-profile-skeleton'}
      gap={16}
      title={<SkeletonBar height={18} width={80} />}
      variant={'filled'}
    >
      <Flexbox>
        <SettingsProfileRowSkeleton
          actionNode={<SkeletonBar height={46} radius={cssVar.borderRadius} width={46} />}
          body={null}
          height={78}
        />
        <div className={styles.divider} />
        <SettingsProfileRowSkeleton action={false} bodyWidth={194} height={68} labelWidth={72} />
        <div className={styles.divider} />
        <SettingsProfileRowSkeleton action={false} bodyWidth={194} height={68} labelWidth={88} />
        <div className={styles.divider} />
        <SettingsProfileRowSkeleton
          action={false}
          body={<InterestsSkeleton />}
          height={210}
          labelWidth={64}
        />
        {isLogin && email && (
          <>
            <div className={styles.divider} />
            <SettingsProfileRowSkeleton bodyWidth={184} height={54} labelWidth={96} />
          </>
        )}
        {enableComposio && isServersInit && hasConnectedServers && (
          <>
            <div className={styles.divider} />
            <SettingsProfileRowSkeleton
              action={false}
              bodyWidth={184}
              height={54}
              labelWidth={136}
            />
          </>
        )}
      </Flexbox>
    </FormGroup>
  );
};

export default SettingsProfileSkeleton;
