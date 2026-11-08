// BAD fixture (rules introduced in 2.1.0): every `expect:` id must be reported by lint-lobe.mjs on that line.
import { createStaticStyles, keyframes } from '@lobehub/ui';
import { Button } from '@lobehub/ui';

const fadeUp = keyframes`from { opacity: 0 } to { opacity: 1 }`; // expect: LOBE-REDUCED-MOTION

export const styles = createStaticStyles(({ css, cssVar }) => ({
  title: css`
    font-size: 16px;
    font-size: 18px;
    font-size: 20px;
    font-size: 22px;
    font-size: 24px;
    font-size: 28px; /* expect: LOBE-FONT-SIZE-SCALE */
    letter-spacing: 0.2em; /* expect: LOBE-LETTER-SPACING */
    padding: 13px 18px; /* expect: LOBE-SPACING-OFFGRID */
    transition: width 200ms ease-out; /* expect: LOBE-ANIMATE-LAYOUT */
    animation: ${fadeUp} 200ms ease-out;
    width: 960px; /* expect: LOBE-FIXED-WIDTH */
  `,
  a: css`background: ${cssVar.gradientAnimation};`,
  b: css`background: ${cssVar.gradientAnimation};`,
  c: css`background: ${cssVar.gradientAnimation};`, /* expect: LOBE-GRADIENT-ANIMATION-OVERUSE */
}));

export const Hero = () => (
  <div className={styles.title}>
    <Button type="primary">开始试用</Button>
    <Button type="primary">预约演示</Button> {/* expect: LOBE-MULTI-PRIMARY */}
  </div>
);

// An ignore without a `: reason` does not suppress anything and is itself reported.
const legacy = '#ff6a00'; // lobe-design-ignore LOBE-RAW-COLOR   expect: LOBE-IGNORE-NO-REASON LOBE-RAW-COLOR
