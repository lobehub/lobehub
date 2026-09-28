import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  bullets: css`
    display: flex;
    flex-direction: column;
    gap: 10px;

    margin: 0;
    margin-block-start: 20px;
    padding: 0;

    list-style: none;

    li {
      position: relative;

      padding-inline-start: 18px;

      font-size: ${cssVar.fontSize};
      line-height: 1.55;
      color: ${cssVar.colorTextSecondary};

      &::before {
        content: '';

        position: absolute;
        inset-block-start: 9px;
        inset-inline-start: 2px;

        width: 5px;
        height: 5px;
        border-radius: 50%;

        background: ${cssVar.colorTextQuaternary};
      }

      strong {
        font-weight: ${cssVar.fontWeightStrong};
        color: ${cssVar.colorText};
      }
    }
  `,
  card: css`
    position: relative;

    overflow: hidden;
    display: flex;
    flex-direction: column;

    background: ${cssVar.colorBgContainer};
  `,
  cardBody: css`
    padding: 32px;
    background: ${cssVar.colorBgContainer};

    @media (width <= 860px) {
      padding: 24px;
    }
  `,
  cardTitle: css`
    margin: 0;
    font-size: ${cssVar.fontSizeXL};
    font-weight: ${cssVar.fontWeightStrong};
    line-height: 1.3;
  `,
  actionSlot: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;

    margin-block-start: auto;
  `,
  cell: css`
    min-height: 260px;
    padding: 28px;
    background: ${cssVar.colorBgContainer};

    @media (width <= 860px) {
      min-height: 220px;
      padding: 24px;
    }
  `,
  cellBody: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-block: 34px 28px;
  `,
  cellMeta: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  channelRow: css`
    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 32px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    @media (width <= 860px) {
      padding-inline: 24px;
    }
  `,
  cliInner: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;
    align-items: stretch;

    background: ${cssVar.colorBorder};

    @media (width <= 860px) {
      grid-template-columns: 1fr;
    }
  `,
  command: css`
    display: inline-flex;
    gap: 10px;
    align-items: center;

    margin-block-start: 20px;
    padding-block: 6px;
    padding-inline: 14px 6px;
    border: 1px solid ${cssVar.colorBorderSecondary};

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorText};

    background: ${cssVar.colorFillQuaternary};
  `,
  content: css`
    width: min(100%, 1080px);
    margin-inline: auto;
    padding-block: 32px 64px;
    padding-inline: 24px;

    @media (width <= 860px) {
      padding-block: 20px 48px;
      padding-inline: 16px;
    }
  `,
  ctaRow: css`
    margin-block-start: 24px;
  `,
  cliShot: css`
    display: block;

    width: 100%;
    height: 100%;
    min-height: 240px;

    object-fit: cover;
    background: #101014;
  `,
  darkOnly: css`
    display: none;

    html[data-theme='dark'] & {
      display: block;
    }
  `,
  desktopShot: css`
    position: absolute;
    inset-block-end: -40px;
    inset-inline-end: -48px;

    width: 540px;
    border-radius: 8px;

    box-shadow: ${cssVar.boxShadow};
  `,
  lightOnly: css`
    html[data-theme='dark'] & {
      display: none;
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1px;

    border: 1px solid ${cssVar.colorBorder};

    background: ${cssVar.colorBorder};

    @media (width <= 860px) {
      grid-template-columns: 1fr;
    }
  `,
  header: css`
    grid-column: 1 / -1;
    min-height: 180px;
    padding: 32px;
    background: ${cssVar.colorBgContainer};

    @media (width <= 860px) {
      min-height: 150px;
      padding: 24px;
    }
  `,
  headerTop: css`
    display: flex;
    gap: 12px;
    align-items: center;
    margin-block-end: 28px;
  `,
  headline: css`
    margin-block: 8px 28px;

    font-size: clamp(24px, 3.2vw, 32px);
    font-weight: ${cssVar.fontWeightStrong};
    line-height: 1.2;
    color: ${cssVar.colorText};
    text-wrap: balance;
    letter-spacing: -0.01em;
  `,
  heroInner: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    flex: 1;
    gap: 1px;

    min-height: 320px;

    background: ${cssVar.colorBorder};

    @media (width <= 860px) {
      grid-template-columns: 1fr;
    }
  `,
  iconBox: css`
    display: block;

    width: 40px;
    height: 40px;
    border-radius: 8px;

    background: ${cssVar.colorFillQuaternary};
  `,
  mobileStage: css`
    position: relative;
    height: 200px;
    margin-block-start: auto;
    background: #f3f0ea;

    html[data-theme='dark'] & {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  page: css`
    overflow-y: auto;
    height: 100%;
    min-height: 100%;
    background: ${cssVar.colorBgLayout};
  `,
  phone: css`
    position: absolute;
    inset-block-end: -64px;
    inset-inline-start: 50%;
    transform: translateX(-50%);

    overflow: hidden;

    width: 216px;
    height: 260px;
    border: 6px solid #1c1c1e;
    border-block-end: none;
    border-start-start-radius: 32px;
    border-start-end-radius: 32px;

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadow};

    html[data-theme='dark'] & {
      border-color: #3a3a40;
    }
  `,
  phoneShot: css`
    display: block;
    width: 100%;
  `,
  spanFull: css`
    grid-column: 1 / -1;
  `,
  stage: css`
    position: relative;
    overflow: hidden;
    min-height: 300px;
    background: #f3f0ea;

    html[data-theme='dark'] & {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
}));
