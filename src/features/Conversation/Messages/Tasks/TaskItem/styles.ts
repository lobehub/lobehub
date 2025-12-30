import { createStaticStyles, keyframes } from 'antd-style';

export const shimmer = keyframes`
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
`;

export const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

export const styles = createStaticStyles(({ css, cssVar }) => ({
  activityText: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  collapseContent: css`
    padding-block: 8px;
    padding-inline: 0;
    font-size: 13px;
    line-height: 1.6;
  `,

  expandToggle: css`
    cursor: pointer;

    display: flex;
    flex-shrink: 0;
    gap: 4px;
    align-items: center;

    margin-inline-start: auto;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  footer: css`
    padding-block-start: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  headerRow: css`
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 12px;
  `,
  initializingText: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  instruction: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    margin-block-start: 2px;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
  `,
  mainContent: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;

    min-width: 0;
  `,
  metricItem: css`
    display: flex;
    gap: 4px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  metricValue: css`
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  progress: css`
    position: relative;

    overflow: hidden;

    height: 3px;
    border-radius: 2px;

    background: ${cssVar.colorFillSecondary};
  `,
  progressBar: css`
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;

    height: 100%;
    border-radius: 2px;

    background: linear-gradient(90deg, ${cssVar.colorPrimary}, ${cssVar.colorPrimaryHover});

    transition: width 0.5s ease-out;
  `,
  progressShimmer: css`
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;

    width: 100%;
    height: 100%;

    background: linear-gradient(90deg, transparent, ${cssVar.colorPrimaryBgHover}, transparent);

    animation: ${shimmer} 2s infinite;
  `,
  separator: css`
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: ${cssVar.colorTextQuaternary};
  `,
  spin: css`
    animation: ${spin} 1s linear infinite;
  `,
  statusIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    margin-block-start: 1px;
    border-radius: 50%;
  `,
  statusIconCompleted: css`
    color: ${cssVar.colorSuccessText};
    background: ${cssVar.colorSuccessBg};
  `,
  statusIconError: css`
    color: ${cssVar.colorErrorText};
    background: ${cssVar.colorErrorBg};
  `,
  statusIconProcessing: css`
    color: ${cssVar.colorPrimaryText};
    background: ${cssVar.colorPrimaryBg};
  `,
  title: css`
    font-weight: 500;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
  titleRow: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  `,
}));
