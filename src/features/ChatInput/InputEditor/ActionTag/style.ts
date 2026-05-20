import { createStaticStyles } from 'antd-style';

import { TAG_MARGIN_INLINE_END } from '../constants';

const colored = (color: string, borderRadius: string) => `
  color: ${color};

  &.selected {
    border-radius: ${borderRadius};
    outline: 2px solid ${color};
    outline-offset: 1px;
  }
`;

export const styles = createStaticStyles(({ css, cssVar }) => ({
  actionTag: css`
    cursor: default;
    user-select: none;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    margin-inline-end: ${TAG_MARGIN_INLINE_END}px;
    padding-inline: 2px;
  `,
  actionTagLabel: css`
    font-weight: 500;
  `,
  commandTag: css`
    ${colored(cssVar.purple, cssVar.borderRadius)}
  `,
  projectSkillTag: css`
    ${colored(cssVar.colorSuccess, cssVar.borderRadius)}
  `,
  skillTag: css`
    ${colored(cssVar.colorSuccess, cssVar.borderRadius)}
  `,
  toolTag: css`
    ${colored(cssVar.colorInfo, cssVar.borderRadius)}
  `,
}));
