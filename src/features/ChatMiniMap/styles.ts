import { createStaticStyles } from 'antd-style';

export const minimapStyles = createStaticStyles(({ css, cssVar }) => ({
  arrow: css`
    opacity: 0;
    transition: opacity ${cssVar.motionDurationMid} ease;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFill};
    }

    &:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBorder};
    }
  `,
  arrowVisible: css`
    opacity: 1;
  `,
  container: css`
    pointer-events: none;

    position: absolute;
    z-index: 1;
    inset-block: 16px 120px;
    inset-inline-end: 8px;

    width: 32px;
  `,
  rail: css`
    pointer-events: auto;

    display: flex;
    flex-direction: column;
    gap: 0;
    align-items: end;
    justify-content: space-between;

    width: 100%;
    height: fit-content;
    margin-block: 0;
    margin-inline: auto;

    &:hover .arrow {
      opacity: 1;
    }
  `,
  railContent: css`
    scrollbar-width: none;

    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0;
    align-items: end;
    justify-content: space-between;

    max-height: 50vh;

    /* Hide scrollbar for IE, Edge and Firefox */
    -ms-overflow-style: none;

    /* Hide scrollbar for Chrome, Safari and Opera */
    &::-webkit-scrollbar {
      display: none;
    }
  `,
}));

export const indicatorStyles = createStaticStyles(({ css, cssVar }) => ({
  indicator: css`
    flex-shrink: 0;

    min-width: 12px;
    height: 12px;
    padding-block: 5px;
    padding-inline: 4px;
  `,
  indicatorActive: css`
    transform: scaleX(1.1);
    background: ${cssVar.colorPrimary};
    box-shadow: 0 0 0 1px ${cssVar.colorPrimaryHover};
  `,
  indicatorContent: css`
    width: 100%;
    height: 100%;
    border-radius: 3px;
    background: ${cssVar.colorFillSecondary};
  `,
  indicatorContentActive: css`
    background: ${cssVar.colorPrimary};
  `,
}));
