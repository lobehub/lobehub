import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  action: css`
    height: auto;
    min-height: ${cssVar.controlHeight};
    white-space: normal;
    overflow-wrap: anywhere;
  `,
  caption: css`
    margin: 0;
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
  `,
  chart: css`
    width: 100%;
    min-width: 0;
    margin: 0;
  `,
  chartAxis: css`
    font-size: ${cssVar.fontSizeSM};
    fill: ${cssVar.colorTextSecondary};
  `,
  chartDrawing: css`
    display: block;
    overflow: visible;
    width: 100%;
    font-family: inherit;
  `,
  chartLegend: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
    font-variant-numeric: tabular-nums;
  `,
  chartSwatch: css`
    flex: none;
    width: 16px;
    height: 2px;
    border-radius: ${cssVar.borderRadiusXS};
  `,
  choices: css`
    width: 100%;
    min-width: 0;

    > label {
      width: 100%;
      min-width: 0;
      padding: ${cssVar.paddingSM};
      border: 1px solid ${cssVar.colorBorderSecondary};
      border-radius: ${cssVar.borderRadius};
      background: transparent;

      > span:last-child {
        flex: 1;
        min-width: 0;
      }

      &:has([data-checked]) {
        border-color: ${cssVar.colorPrimaryBorder};
        background: ${cssVar.colorFillQuaternary};
      }

      &:has(:focus-visible) {
        outline: 2px solid ${cssVar.colorPrimary};
        outline-offset: 2px;
      }

      &:hover:not(:has([data-disabled])) {
        background: ${cssVar.colorFillTertiary};
      }
    }
  `,
  choiceLabel: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    min-width: 0;

    @container native-ui (width < 280px) {
      grid-template-columns: 1fr;
    }
  `,
  choiceValue: css`
    flex-shrink: 0;
    max-width: min(140px, 100%);
    font-size: ${cssVar.fontSizeLG};
    font-weight: ${cssVar.fontWeightStrong};
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  `,
  content: css`
    min-width: 0;
  `,
  fieldLabel: css`
    font-weight: ${cssVar.fontWeightStrong};
    overflow-wrap: anywhere;
  `,
  fieldValue: css`
    max-width: 100%;
    font-size: ${cssVar.fontSizeXL};
    font-weight: ${cssVar.fontWeightStrong};
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(var(--native-ui-columns), minmax(0, 1fr));
    gap: var(--native-ui-gap);
    min-width: 0;

    @container native-ui (width < 480px) {
      grid-template-columns: 1fr;
    }
  `,
  heading: css`
    margin: 0;
    font-size: ${cssVar.fontSizeLG};
    font-weight: ${cssVar.fontWeightStrong};
    line-height: ${cssVar.lineHeight};
    overflow-wrap: anywhere;
  `,
  input: css`
    width: 144px;
    max-width: 100%;
    font-variant-numeric: tabular-nums;
  `,
  metricValue: css`
    font-size: ${cssVar.fontSizeXL};
    font-weight: ${cssVar.fontWeightStrong};
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  `,
  secondary: css`
    color: ${cssVar.colorTextSecondary};
  `,
  shell: css`
    container: native-ui / inline-size;

    width: 100%;
    min-width: 0;
    padding: ${cssVar.padding};
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    font-family: inherit;
    font-size: ${cssVar.fontSize};
    line-height: ${cssVar.lineHeight};
    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};
  `,
  text: css`
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  `,
}));
