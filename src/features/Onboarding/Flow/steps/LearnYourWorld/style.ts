import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
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
