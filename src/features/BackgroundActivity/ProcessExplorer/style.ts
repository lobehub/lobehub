import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    overflow: auto;
    flex: 1;

    min-height: 0;
    padding-block: 0 8px;
    padding-inline: 6px;
  `,
  cells: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) 80px 88px 64px 32px;
    flex: 1;
    align-items: center;

    min-width: 0;
  `,
  dot: css`
    flex: none;

    width: 6px;
    height: 6px;
    border-radius: 50%;

    background: ${cssVar.colorWarning};
  `,
  header: css`
    position: sticky;
    z-index: 2;
    inset-block-start: 0;

    height: 30px;
    margin-block-end: 4px;
    margin-inline: -6px;
    padding-inline: 36px 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 11.5px;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorBgContainer};
  `,
  headerPid: css`
    text-align: end;
  `,
  hot: css`
    font-weight: 500;
    color: ${cssVar.colorWarning} !important;
  `,
  kind: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
  `,
  label: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  live: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;

    i {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: ${cssVar.colorSuccess};
    }
  `,
  name: css`
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
  `,
  node: css`
    cursor: default;

    &:hover [data-stop-cell],
    &[aria-selected='true'] [data-stop-cell],
    &:focus-within [data-stop-cell] {
      visibility: visible;
    }
  `,
  num: css`
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};
    text-align: end;
  `,
  pid: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11.5px;
    color: ${cssVar.colorTextTertiary};
    text-align: end;
  `,
  section: css`
    font-size: 11px;
    font-weight: 600;
    color: ${cssVar.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 0.05em;
  `,
  sort: css`
    cursor: pointer;

    display: inline-flex;
    gap: 3px;
    align-items: center;
    justify-content: flex-end;

    padding: 0;
    border: 0;

    font: inherit;
    color: inherit;

    background: none;

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  sortActive: css`
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  stat: css`
    display: inline-flex;
    gap: 6px;
    align-items: baseline;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;

    b {
      font-size: 13px;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: ${cssVar.colorText};
    }
  `,
  status: css`
    flex: none;

    height: 28px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 11.5px;
    color: ${cssVar.colorTextTertiary};
  `,
  stop: css`
    justify-self: end;
    visibility: hidden;
  `,
  sub: css`
    flex: none;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;
  `,
  title: css`
    flex: 1;
    padding-inline-end: 6px;
  `,
  toolbar: css`
    flex: none;
    height: 44px;
    padding-inline: 16px 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));
