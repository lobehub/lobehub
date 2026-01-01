import { createStaticStyles } from 'antd-style';

export const MIN_IMAGE_SIZE = 64;
export const MAX_SIZE_DESKTOP = 200;
export const MAX_SIZE_MOBILE = 90;

export const styles = createStaticStyles(({ css }) => ({
  container: css`
    display: grid;
    grid-gap: var(--galley-grid-gap, 6px);
    grid-template-columns: repeat(var(--galley-grid-col, 3), 1fr);

    width: 100%;
    max-width: var(--galley-grid-max, 200px);

    & > div {
      width: 100%;
      min-width: var(--galley-grid-min, 64px);
      min-height: var(--galley-grid-min, 64px);
      max-height: calc(
        (
            var(--galley-grid-max, 200px) - var(--galley-grid-gap, 6px) *
              (var(--galley-grid-col, 3) - 1)
          ) /
          var(--galley-grid-col, 3)
      );
    }
  `,
}));
