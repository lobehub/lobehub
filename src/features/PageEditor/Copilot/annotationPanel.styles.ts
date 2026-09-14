import { createStaticStyles, cssVar } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  absoluteCard: css`
    position: absolute;
    inset-inline: 12px;

    box-sizing: border-box;
    width: auto;
    min-width: 0;
    max-width: 100%;
  `,
  card: css`
    overflow: hidden;

    box-sizing: border-box;
    min-width: 0;
    max-width: 100%;
    padding: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowTertiary};

    transition:
      border-color ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut},
      background ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut},
      box-shadow ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};

    &:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillQuaternary};
    }

    &[data-annotation-selected='true'] {
      border-color: ${cssVar.colorPrimaryBorder};
      background: ${cssVar.colorPrimaryBg};
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
    }

    &[data-annotation-selected='true']:hover {
      border-color: ${cssVar.colorPrimary};
      background: ${cssVar.colorPrimaryBgHover};
    }

    &:focus-within {
      border-color: ${cssVar.colorPrimaryBorder};
    }

    @media (prefers-reduced-motion: reduce) {
      transition-duration: 0s;
    }
  `,
  cardCount: css`
    flex: none;

    min-width: 20px;
    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 999px;

    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;

    background: ${cssVar.colorFillTertiary};

    [data-annotation-selected='true'] & {
      color: ${cssVar.colorPrimary};
      background: ${cssVar.colorPrimaryBgHover};
    }
  `,
  cardHeader: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    padding: 2px;
    border: 0;
    border-radius: ${cssVar.borderRadius};

    color: inherit;
    text-align: start;

    background: transparent;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 2px;
    }
  `,
  cardHeaderMain: css`
    display: flex;
    flex: 1;
    gap: 8px;
    align-items: center;

    min-width: 0;
    max-width: 100%;
  `,
  cardIcon: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
    transition: color ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};

    [data-annotation-selected='true'] & {
      color: ${cssVar.colorPrimary};
    }
  `,
  cardLabel: css`
    overflow: hidden;

    min-width: 0;

    font-size: 13px;
    font-weight: 600;
    line-height: 18px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  cardChevron: css`
    flex: none;
    color: ${cssVar.colorTextQuaternary};
    transition:
      color ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut},
      transform ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};

    [data-annotation-selected='true'] & {
      color: ${cssVar.colorPrimary};
    }
  `,
  cardChevronExpanded: css`
    transform: rotate(180deg);
  `,
  canvas: css`
    position: relative;

    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    min-height: 100%;
  `,
  commentButton: css`
    cursor: pointer;

    display: block;

    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    margin-block-start: 8px;
    padding-block: 9px 1px;
    padding-inline: 2px;
    border: 0;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 0;

    color: inherit;
    text-align: start;

    background: transparent;

    transition: background ${cssVar.motionDurationFast} ${cssVar.motionEaseInOut};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition-duration: 0s;
    }
  `,
  commentQuote: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    box-sizing: border-box;
    min-width: 0;
    max-width: 100%;
    margin-block-start: 4px;
    padding-inline-start: 8px;
    border-inline-start: 2px solid ${cssVar.colorFillSecondary};

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
  `,
  commentText: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    box-sizing: border-box;
    min-width: 0;
    max-width: 100%;

    font-size: 13px;
    line-height: 18px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    word-break: break-word;
    overflow-wrap: anywhere;
  `,
  composerCard: css`
    min-width: 0;
    max-width: 100%;
    padding: 0;
    border: 0;

    background: transparent;
    box-shadow: none;
  `,
  emptyCard: css`
    display: flex;
    align-items: center;
    justify-content: center;

    padding-block: 24px;
    padding-inline: 12px;

    & .ant-empty {
      margin: 0;
    }
  `,
  error: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    margin-block-start: 8px;
    margin-inline: 12px;
    padding-block: 8px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorErrorBorder};
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;
    color: ${cssVar.colorErrorText};

    background: ${cssVar.colorErrorBg};
  `,
  errorMessage: css`
    flex: 1;
    min-width: 0;
    max-width: 100%;
  `,
  errorRetry: css`
    overflow: hidden;
    flex: none;

    min-width: 0;
    max-width: 100%;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  loadingCard: css`
    display: flex;
    align-items: center;
    justify-content: center;

    min-height: 52px;
    padding-block: 14px;
    padding-inline: 12px;

    color: ${cssVar.colorTextTertiary};
  `,
  loadingContent: css`
    display: flex;
    gap: 8px;
    align-items: center;

    min-width: 0;
    max-width: 100%;

    font-size: 12px;
    word-break: break-word;
    overflow-wrap: anywhere;
  `,
  rail: css`
    scrollbar-color: ${cssVar.colorFillSecondary} transparent;
    scrollbar-width: thin;
    scrollbar-gutter: stable;

    position: relative;

    overflow: hidden auto;
    overscroll-behavior: contain;
    flex: 1;

    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    min-height: 0;

    &::-webkit-scrollbar {
      width: 6px;
    }

    &::-webkit-scrollbar-thumb {
      border: 1px solid transparent;
      border-radius: 999px;
      background: ${cssVar.colorFillSecondary};
      background-clip: padding-box;
    }

    &::-webkit-scrollbar-thumb:hover {
      background: ${cssVar.colorFill};
      background-clip: padding-box;
    }
  `,
  root: css`
    position: relative;

    overflow-x: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    width: 100%;
    min-width: 0;
    max-width: 100%;
    min-height: 0;
  `,
}));
