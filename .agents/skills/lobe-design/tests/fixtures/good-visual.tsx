// GOOD fixture (2.1.0 rules): lint-lobe.mjs must report zero findings here. Guards against over-matching.
import { createStaticStyles, keyframes } from '@lobehub/ui';
import { Button } from '@lobehub/ui';

const fadeIn = keyframes`from { opacity: 0 } to { opacity: 1 }`;

export const styles = createStaticStyles(({ css, cssVar, responsive }) => ({
  title: css`
    font-size: 14px;
    font-size: 20px;
    font-size: 32px;
    font-size: 48px;
    letter-spacing: -0.02em;
    padding: 12px 24px;
    gap: 6px;
    margin: 0 auto;
    border-width: 1px;
    transition: opacity 150ms ease-out, transform 200ms ease-out;
    animation: ${fadeIn} 200ms ease-out;
    max-width: 960px;
    background: ${cssVar.gradientAnimation};
    @media (prefers-reduced-motion: reduce) { animation: none; }
    ${responsive.sm} { padding: 8px; }
  `,
}));

export const Hero = () => (
  <div className={styles.title}>
    <Button type="primary">开始试用</Button>
    <Button variant="outlined">查看定价</Button>
  </div>
);

// Real-world false positives found on lobehub/src/features (LRN-20261014-07): must stay clean.
export const isWide = () => window.matchMedia('(min-width: 768px)').matches;
const viewport = { height: 600, width: 1000 };

// lobe-design-ignore LOBE-RAW-COLOR: 法务要求的品牌资产色，已登记 D-11 缺口
const brand = '#ff6a00';
