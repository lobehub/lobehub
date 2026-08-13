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
    gap: 12px;
    align-items: flex-start;

    padding-block: 12px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorFillSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

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
  cardBody: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;

    min-width: 0;
  `,
  cardCheck: css`
    flex: none;
    color: ${cssVar.colorPrimary};
  `,
  cardCheckHidden: css`
    visibility: hidden;
  `,
  cardDescription: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: 12px;
    line-height: 1.5;
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

    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  empty: css`
    display: flex;
    align-items: center;
    justify-content: center;

    min-height: 160px;
    padding: 24px;

    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  filterBar: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  `,
  footer: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-block-start: 8px;
  `,
  footerActions: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 10px;
    align-content: start;
  `,
  pill: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    background: transparent;

    transition:
      border-color ${cssVar.motionDurationMid},
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
  pillActive: css`
    border-color: ${cssVar.colorFillSecondary};
    font-weight: 500;
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  scrollArea: css`
    overflow-y: auto;
    overscroll-behavior: contain;

    max-height: min(46vh, 360px);
    margin-inline: -4px;
    padding-inline: 4px;
  `,
  skeletonAvatar: css`
    flex: none;

    width: 36px;
    height: 36px;
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorFillTertiary};

    animation: ${pulse} 1.5s ease-in-out infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
  skeletonCard: css`
    display: flex;
    gap: 12px;

    padding-block: 12px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorFillSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  skeletonLine: css`
    height: 10px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillTertiary};
    animation: ${pulse} 1.5s ease-in-out infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
  skeletonPill: css`
    width: 72px;
    height: 28px;
    border-radius: 999px;

    background: ${cssVar.colorFillTertiary};

    animation: ${pulse} 1.5s ease-in-out infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  `,
}));
