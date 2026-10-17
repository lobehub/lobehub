import { createStaticStyles, cssVar } from '@lobehub/ui';

export const replicaStyles = createStaticStyles(({ css }) => ({
  actions: css`
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;

    padding-block: 6px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  badge: css`
    padding-inline: 4px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusXS};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 10px;
    line-height: 16px;
    color: ${cssVar.colorTextTertiary};
  `,
  badgePending: css`
    border-color: ${cssVar.colorWarningBorder};
    color: ${cssVar.colorWarning};
  `,
  editor: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;

    min-height: 0;
    padding: 12px;
  `,
  editorFooter: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  editorError: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorError};
    overflow-wrap: anywhere;
  `,
  editorInput: css`
    flex: 1;
    min-height: 200px;
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
  `,
  persistToggle: css`
    display: flex;
    gap: 6px;
    align-items: center;
  `,
  resourceMeta: css`
    display: flex;
    flex-shrink: 0;
    gap: 4px;
  `,
}));
