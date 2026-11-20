import { createStaticStyles } from '@lobehub/ui';

export const cardStyles = createStaticStyles(({ css, cssVar }) => ({
  arrow: css`
    flex: none;
    color: ${cssVar.colorTextQuaternary};
  `,
  card: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillQuaternary};
  `,
  label: css`
    flex: none;
    min-width: 40px;
    color: ${cssVar.colorTextDescription};
  `,
  row: css`
    padding-block: 4px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  status: css`
    flex: none;
    font-size: 12px;
  `,
}));
