import { createStaticStyles, keyframes } from 'antd-style';

const pulse = keyframes`
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.5;
  }
`;

export const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    cursor: pointer;

    display: flex;
    flex-direction: column;
    gap: 10px;

    padding: 16px;
    border: 1px solid ${cssVar.colorFillSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};

    transition:
      border-color ${cssVar.motionDurationMid},
      background ${cssVar.motionDurationMid};

    &:hover {
      border-color: ${cssVar.colorPrimaryHover};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  cardHeader: css`
    display: flex;
    gap: 10px;
    align-items: center;
    min-width: 0;
  `,
  cardDescription: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;

    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
  cardSelected: css`
    border-color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBg};

    &:hover {
      border-color: ${cssVar.colorPrimary};
    }
  `,
  cardTitle: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  container: css`
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    flex: 1;
    gap: 12px;

    min-height: 0;
  `,
  content: css`
    overflow-y: auto;
    overscroll-behavior: contain;

    min-width: 0;
    min-height: 0;
    padding-inline-end: 4px;
  `,
  categoryItem: css`
    cursor: pointer;

    flex: none;

    padding-block: 6px;
    padding-inline: 12px;
    border: none;
    border-radius: ${cssVar.borderRadius};

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    background: transparent;

    transition:
      background ${cssVar.motionDurationMid},
      color ${cssVar.motionDurationMid};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  categoryItemActive: css`
    font-weight: 500;
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  empty: css`
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;

    min-height: 160px;
    padding: 24px;

    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
  footer: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
    align-content: start;
  `,
  header: css`
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 8px;
  `,
  root: css`
    position: absolute;
    z-index: 10;
    inset-block-end: 0;
    inset-inline: 0;

    overflow: hidden;

    height: min(640px, 72vh);
    min-height: 480px;
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: 0 16px 48px color-mix(in srgb, #000 16%, transparent);
  `,
  tabBar: css`
    overflow: auto hidden;
    overscroll-behavior: contain;
    display: flex;
    flex-flow: row nowrap;
    gap: 6px;

    margin-inline: -12px;
    padding-block-end: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  skeletonAvatar: css`
    flex: none;

    width: 36px;
    height: 36px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillTertiary};

    animation: ${pulse} 1.5s ease-in-out infinite;
  `,
  skeletonCard: css`
    display: flex;
    flex-direction: column;
    gap: 10px;

    padding: 16px;
    border: 1px solid ${cssVar.colorFillSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
  `,
  skeletonLine: css`
    height: 10px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillTertiary};
    animation: ${pulse} 1.5s ease-in-out infinite;
  `,
  skeletonTabBarItem: css`
    flex: none;

    width: 88px;
    height: 32px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillTertiary};

    animation: ${pulse} 1.5s ease-in-out infinite;
  `,
  skipLink: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 0;

    font-size: 13px;

    transition: color ${cssVar.motionDurationMid};

    &:hover {
      color: ${cssVar.colorPrimary} !important;
    }
  `,
}));
