import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Footer hosting the approve / reject actions (portal target). Hidden until
  // the Intervention component fills it.
  actions: css`
    padding-block: 8px 12px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    background: color-mix(in srgb, ${cssVar.colorBgElevated} 92%, ${cssVar.colorFillSecondary});

    &:empty {
      display: none;
    }
  `,
  card: css`
    pointer-events: auto;

    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  content: css`
    overflow-y: auto;
    flex: 1;

    min-height: 0;
    max-height: 42vh;
    padding-block: 6px 8px;
    padding-inline: 12px;
  `,
  header: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  headerMeta: css`
    overflow: hidden;
    flex: 1;
    min-width: 0;
  `,
  headerSubtitle: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  headerTitle: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  // "+N more pending" hint shown when several conversations are waiting; only
  // the top card is actionable at once.
  moreHint: css`
    pointer-events: auto;

    align-self: center;

    padding-block: 2px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  // Collapsed "dynamic island" pill.
  pill: css`
    pointer-events: auto;
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    height: 36px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;

    font-size: 13px;
    color: ${cssVar.colorText};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  pillDot: css`
    flex-shrink: 0;

    width: 7px;
    height: 7px;
    border-radius: 999px;

    background: ${cssVar.colorPrimary};
  `,
  stack: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  `,
  // The user request that triggered the tool call — context for the approval.
  userRequest: css`
    display: flex;
    gap: 6px;
    align-items: baseline;

    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
  userRequestLabel: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  userRequestText: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
  `,
  // Top-center fixed wrapper. The wrapper ignores pointer events so it never
  // blocks the page; only the cards / pill re-enable them.
  wrapper: css`
    pointer-events: none;

    position: fixed;
    z-index: 1000;
    inset-block-start: var(--global-approval-top, 16px);
    inset-inline-start: 50%;
    transform: translateX(-50%);

    display: flex;
    flex-direction: column;
    align-items: center;

    width: min(640px, 92vw);
  `,
}));
