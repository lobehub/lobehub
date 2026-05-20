import { createStaticStyles } from 'antd-style';

export const minimapStyles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    pointer-events: none;

    position: absolute;
    z-index: 1;
    inset-block: 16px 120px;
    inset-inline-end: 8px;

    display: flex;
    flex-direction: column;
    align-items: end;
    justify-content: center;
  `,
  hoverArea: css`
    pointer-events: auto;

    position: relative;

    display: flex;
    flex-direction: column;
    align-items: end;
  `,
  previewPanel: css`
    pointer-events: none;

    position: absolute;
    inset-block-start: 50%;
    inset-inline-end: 0;
    transform-origin: 100% 50%;
    transform: translateY(-50%) scale(0.96);

    overflow: hidden;
    display: flex;

    min-width: 240px;
    max-width: 360px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    opacity: 0;
    background: ${cssVar.colorBgElevated};
    box-shadow:
      0 6px 16px 0 rgb(0 0 0 / 8%),
      0 3px 6px -4px rgb(0 0 0 / 12%),
      0 9px 28px 8px rgb(0 0 0 / 5%);

    transition:
      opacity ${cssVar.motionDurationMid} ease,
      transform ${cssVar.motionDurationMid} ease;
  `,
  previewPanelVisible: css`
    pointer-events: auto;
    transform: translateY(-50%) scale(1);
    opacity: 1;
  `,
  rail: css`
    scrollbar-width: none;

    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0;
    align-items: end;

    max-height: 50vh;

    transition: opacity ${cssVar.motionDurationMid} ease;

    /* Hide scrollbar for IE, Edge and Firefox */
    -ms-overflow-style: none;

    /* Hide scrollbar for Chrome, Safari and Opera */
    &::-webkit-scrollbar {
      display: none;
    }
  `,
  railFaded: css`
    pointer-events: none;
    opacity: 0;
  `,
}));

export const indicatorStyles = createStaticStyles(({ css, cssVar }) => ({
  indicator: css`
    cursor: pointer;

    flex-shrink: 0;

    min-width: 5px;
    height: 12px;
    padding-block: 5px;
  `,
  indicatorContent: css`
    width: 100%;
    height: 100%;
    border-radius: 2px;
    background: ${cssVar.colorFillSecondary};
  `,
  indicatorContentActive: css`
    background: ${cssVar.colorPrimary};
  `,
}));

export const previewStyles = createStaticStyles(({ css, cssVar }) => ({
  dash: css`
    flex-shrink: 0;
    height: 2px;
    border-radius: 2px;
    background: ${cssVar.colorFillSecondary};
  `,
  dashActive: css`
    background: ${cssVar.colorPrimary};
  `,
  item: css`
    cursor: pointer;

    padding-block: 6px;
    padding-inline: 12px;
    border-radius: 6px;

    color: ${cssVar.colorTextSecondary};

    transition: background-color ${cssVar.motionDurationFast} ease;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  itemActive: css`
    color: ${cssVar.colorPrimary};
  `,
  label: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    font-size: 13px;
    line-height: 1.4;
    text-align: end;
    text-overflow: ellipsis;
    word-break: break-word;
  `,
  labelActive: css`
    font-weight: 500;
    color: ${cssVar.colorPrimary};
  `,
  list: css`
    scrollbar-width: thin;

    overflow-y: auto;

    max-height: 60vh;
    padding-block: 4px;
    padding-inline: 4px;

    &::-webkit-scrollbar {
      width: 4px;
    }

    &::-webkit-scrollbar-thumb {
      border-radius: 2px;
      background: ${cssVar.colorFillSecondary};
    }
  `,
}));
