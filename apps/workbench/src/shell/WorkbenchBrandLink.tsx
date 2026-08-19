'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';

const styles = createStaticStyles(({ css }) => ({
  brand: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    box-sizing: content-box;
    padding: 4px;
    border-radius: ${cssVar.borderRadius};

    line-height: 0;

    transition: background 120ms ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  divider: css`
    flex: none;

    width: 1px;
    height: 16px;

    background: ${cssVar.colorBorderSecondary};

    transition:
      width 200ms ${cssVar.motionEaseOut},
      opacity 200ms ${cssVar.motionEaseOut};

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  dividerCollapsed: css`
    overflow: hidden;
    flex: none;

    width: 0;
    height: 16px;

    opacity: 0;

    transition:
      width 200ms ${cssVar.motionEaseOut},
      opacity 200ms ${cssVar.motionEaseOut};

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  slot: css`
    overflow: hidden;
    flex: none;

    width: 30px;
    height: 30px;

    transition: width 200ms ${cssVar.motionEaseOut};

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  slotCollapsed: css`
    overflow: hidden;
    flex: none;

    width: 0;
    height: 30px;

    transition: width 200ms ${cssVar.motionEaseOut};

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  cluster: css`
    overflow: hidden;
    display: flex;
    flex: none;
    gap: 8px;
    align-items: center;

    max-width: 39px;

    transition:
      max-width 200ms ${cssVar.motionEaseOut},
      gap 200ms ${cssVar.motionEaseOut};

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  clusterCollapsed: css`
    overflow: hidden;
    display: flex;
    flex: none;
    gap: 0;
    align-items: center;

    max-width: 0;

    transition:
      max-width 200ms ${cssVar.motionEaseOut},
      gap 200ms ${cssVar.motionEaseOut};

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
}));

export const WorkbenchBrandSlot = memo<{ collapsed?: boolean }>(({ collapsed = false }) => (
  <div className={collapsed ? styles.slotCollapsed : styles.slot} />
));

WorkbenchBrandSlot.displayName = 'WorkbenchBrandSlot';

export const WorkbenchBrandDivider = memo<{ collapsed?: boolean }>(({ collapsed = false }) => (
  <div className={collapsed ? styles.dividerCollapsed : styles.divider} />
));

WorkbenchBrandDivider.displayName = 'WorkbenchBrandDivider';

export const WorkbenchBrandCluster = memo<{ collapsed?: boolean }>(({ collapsed = false }) => (
  <div className={collapsed ? styles.clusterCollapsed : styles.cluster}>
    <WorkbenchBrandSlot />
    <WorkbenchBrandDivider />
  </div>
));

WorkbenchBrandCluster.displayName = 'WorkbenchBrandCluster';

interface WorkbenchBrandLinkProps {
  divider?: boolean;
}

const WorkbenchBrandLink = memo<WorkbenchBrandLinkProps>(({ divider = true }) => {
  const { t } = useTranslation('verify');
  const label = t('actions.backToApp', { name: BRANDING_NAME });

  return (
    <>
      <a aria-label={label} className={styles.brand} href={'/'} title={label}>
        <ProductLogo size={22} />
      </a>
      {divider ? <WorkbenchBrandDivider /> : null}
    </>
  );
});

WorkbenchBrandLink.displayName = 'WorkbenchBrandLink';

export default WorkbenchBrandLink;
