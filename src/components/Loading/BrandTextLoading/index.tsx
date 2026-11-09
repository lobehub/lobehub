// oxlint-disable-next-line stylex-migration/no-emotion-styles -- BrandLoading renders its svg without a slot
import { createStaticStyles } from '@lobehub/ui';
import { BrandLoading, LobeHubText } from '@lobehub/ui/brand';
import * as stylex from '@stylexjs/stylex';

import { isCustomBranding } from '@/const/version';

import CircleLoading from '../CircleLoading';

const fallback = createStaticStyles(({ css }) => ({
  brand: css`
    display: flex;
    gap: 12px;
    align-items: center;

    color: var(--brand-text-color);

    opacity: 0.6;

    .lobe-brand-loading {
      display: block;
      color: inherit;
    }
  `,
  container: css`
    --brand-text-color: var(--colorText, #1f1f1f);
    --brand-muted-color: var(--colorTextSecondary, #8c8c8c);
    --brand-border-color: var(--colorBorder, #d9d9d9);
    --brand-tag-bg: var(--colorFillTertiary, rgb(0 0 0 / 4%));

    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    justify-content: center;

    width: 100%;
    height: 100vh;
    height: 100dvh;

    [data-theme='dark'] & {
      --brand-text-color: var(--colorText, #f0f0f0);
      --brand-muted-color: var(--colorTextSecondary, #a6a6a6);
      --brand-border-color: var(--colorBorder, #424242);
      --brand-tag-bg: var(--colorFillTertiary, rgb(255 255 255 / 8%));
    }
  `,
  debugRow: css`
    display: flex;
    gap: 8px;
    align-items: center;

    font-size: 12px;
    color: var(--brand-muted-color);

    code {
      font-family:
        ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
        monospace;
    }
  `,
  debugTag: css`
    display: inline-flex;
    align-items: center;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 6px;

    background: var(--brand-tag-bg);

    code {
      color: var(--brand-text-color);
    }
  `,
}));

const stylesAtomic = stylex.create({
  debug: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    padding: '16px',
  },
  debugHint: { fontSize: '12px', color: 'var(--brand-muted-color)' },
});

interface BrandTextLoadingProps {
  debugId: string;
}

const BrandTextLoading = ({ debugId }: BrandTextLoadingProps) => {
  if (isCustomBranding)
    return (
      <div className={fallback.container}>
        <CircleLoading />
      </div>
    );

  const showDebug = process.env.NODE_ENV === 'development' && debugId;

  return (
    <div className={fallback.container}>
      <div aria-label="Loading" className={fallback.brand} role="status">
        <BrandLoading size={40} text={LobeHubText} />
      </div>
      {showDebug && (
        <div {...stylex.props(stylesAtomic['debug'])}>
          <div className={fallback.debugRow}>
            <code>Debug ID:</code>
            <span className={fallback.debugTag}>
              <code>{debugId}</code>
            </span>
          </div>
          <div {...stylex.props(stylesAtomic['debugHint'])}>only visible in development</div>
        </div>
      )}
    </div>
  );
};

export default BrandTextLoading;
