import { createStaticStyles, cssVar } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  composer: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;

    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    min-height: 0;
    padding: 12px;
  `,
  error: css`
    font-size: 12px;
    color: ${cssVar.colorError};
  `,
  header: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  `,
  selectionStatus: css`
    padding-block: 6px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorPrimaryBorder};
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  input: css`
    position: sticky;
    z-index: 1;
    inset-block-end: 0;

    flex: none;

    width: 100%;
    height: auto !important;
    min-height: 0;
  `,
  inputHint: css`
    font-size: 12px;
  `,
  imageNotice: css`
    color: ${cssVar.colorWarning};
  `,
  panel: css`
    overflow: hidden auto;
    display: flex;
    flex: 1;
    flex-direction: column;

    min-height: 0;
  `,
  loading: css`
    padding: 16px;
  `,
  empty: css`
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;

    padding-block: 24px;
    padding-inline: 16px;

    text-align: center;
  `,
  requestList: css`
    display: flex;
    flex-direction: column;
    gap: 6px;

    padding-block: 8px 12px;
    padding-inline: 10px;
  `,
  sessionGroup: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  activeSummary: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  activeCount: css`
    font-size: 12px;
    font-weight: 500;
  `,
  activeLimit: css`
    font-size: 12px;
    color: ${cssVar.colorWarning};
  `,
  requestCard: css`
    display: flex;
    flex-direction: column;
    gap: 4px;

    padding: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};

    &[data-rewrite-priority='active'] {
      border-color: ${cssVar.colorPrimaryBorder};
      background: ${cssVar.colorPrimaryBg};
    }

    &[data-rewrite-priority='attention'] {
      border-color: ${cssVar.colorErrorBorder};
      background: ${cssVar.colorErrorBg};
    }
  `,
  requestHeader: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  `,
  requestHeaderActions: css`
    display: flex;
    flex: none;
    gap: 2px;
    align-items: center;
  `,
  requestAgent: css`
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  `,
  status: css`
    flex: none;

    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 999px;

    font-size: 12px;
    font-weight: 500;

    background: ${cssVar.colorFillQuaternary};

    &[data-rewrite-status='active'] {
      color: ${cssVar.colorPrimary};
      background: ${cssVar.colorPrimaryBgHover};
    }

    &[data-rewrite-status='failed'],
    &[data-rewrite-status='stale'] {
      color: ${cssVar.colorError};
      background: ${cssVar.colorErrorBg};
    }

    &[data-rewrite-status='applied'] {
      color: ${cssVar.colorSuccess};
      background: ${cssVar.colorSuccessBg};
    }
  `,
  instruction: css`
    overflow: hidden;

    font-size: 14px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  sessionMeta: css`
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: space-between;

    min-height: 20px;
  `,
  sessionRounds: css`
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  historyToggle: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    padding-block: 1px;
    padding-inline: 4px;
    border: 0;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 11px;
    line-height: 18px;
    color: ${cssVar.colorTextSecondary};

    background: transparent;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
    }
  `,
  requestDetails: css`
    font-size: 12px;
  `,
  requestDetailsSummary: css`
    cursor: pointer;

    width: fit-content;
    padding-block: 2px;
    padding-inline: 2px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 11px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimaryBorder};
      outline-offset: 1px;
    }
  `,
  requestDetailsContent: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-block: 2px 1px;
  `,
  appliedContext: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    padding-block: 4px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    background: ${cssVar.colorSuccessBg};
  `,
  appliedContextLabel: css`
    overflow: hidden;

    min-width: 0;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorSuccess};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  historyList: css`
    display: flex;
    flex-direction: column;
    gap: 4px;

    padding-block-start: 2px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  historyRow: css`
    display: flex;
    gap: 6px;
    align-items: center;

    min-width: 0;
    padding-block: 4px;
    padding-inline: 2px;
    border-radius: ${cssVar.borderRadiusSM};

    &:hover,
    &:focus-within {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  historyRowMain: css`
    display: flex;
    flex: 1;
    gap: 6px;
    align-items: center;

    min-width: 0;
  `,
  historyRound: css`
    flex: none;
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  historyInstruction: css`
    overflow: hidden;

    min-width: 0;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  historyStatus: css`
    flex: none;
    font-size: 11px;
  `,
  quotePreview: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  quoteLabel: css`
    margin-inline-end: 4px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  controls: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    justify-content: flex-end;
  `,
  historyControls: css`
    flex: none;
    flex-wrap: nowrap;
  `,
  awareness: css`
    display: flex;
    flex-direction: column;
    gap: 8px;

    padding: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  awarenessItem: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  awarenessDot: css`
    width: 8px;
    height: 8px;
    border-radius: 999px;
  `,
}));
