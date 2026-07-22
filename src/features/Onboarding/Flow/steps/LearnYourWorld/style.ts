import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  errorBanner: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: 8px;
    background: ${cssVar.colorErrorBg};
  `,

  errorText: css`
    flex: 1;
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,

  fact: css`
    font-size: 14px;
  `,

  factSkeleton: css`
    width: 100%;
    height: 20px;
  `,

  progressIcon: css`
    flex: none;
    color: ${cssVar.colorTextDescription};
  `,

  progressIconDone: css`
    color: ${cssVar.colorSuccess};
  `,

  progressLabel: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,

  sectionHint: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
}));
