// BAD fixture: every line marked `expect:` must be reported by lint-lobe.mjs.
import { Button, Table, message } from 'antd'; // expect: LOBE-ANTD-IMPORT
import { Form } from '@lobehub/ui'; // expect: LOBE-FORM-ENTRY
import { DeleteOutlined } from '@ant-design/icons'; // expect: LOBE-ANT-ICONS
import { createStyles } from 'antd-style'; // expect: LOBE-CREATE-STYLES LOBE-ANTD-IMPORT

export const useStyles = createStyles(({ css }) => ({ // expect: LOBE-CREATE-STYLES
  hero: css`
    // this is not a comment in a css template   expect: LOBE-CSS-LINE-COMMENT
    background: linear-gradient(135deg, #6366f1, #a855f7); /* expect: LOBE-PURPLE-GRADIENT LOBE-RAW-COLOR */
    color: #333; /* expect: LOBE-RAW-COLOR */
    font-family: Inter, sans-serif; /* expect: LOBE-FONT-FAMILY */
    transition: all 500ms cubic-bezier(0.68, -0.55, 0.27, 1.55); /* expect: LOBE-TRANSITION-ALL LOBE-BOUNCE LOBE-MOTION-DURATION */
    outline: none; /* expect: LOBE-OUTLINE-NONE */
    background-clip: text; /* expect: LOBE-GRADIENT-TEXT */
    text-transform: uppercase; /* expect: LOBE-UPPERCASE */
    box-shadow: 0 0 24px rgba(99, 102, 241, 0.6); /* expect: LOBE-GLOW LOBE-RAW-COLOR */
    backdrop-filter: blur(12px); /* expect: LOBE-BLUR-CARD */
    border-left: 4px solid red; /* expect: LOBE-SIDE-STRIPE */
  `,
}));

export const Page = () => (
  <div>
    <span className="eyebrow">NEW FEATURE</span> {/* expect: LOBE-EYEBROW */}
    <img src="/a.png" /> {/* expect: LOBE-IMG-ALT */}
    <div onClick={() => message.info('x')}>open</div> {/* expect: LOBE-DIV-CLICK */}
    <p>Lorem ipsum dolor sit amet</p> {/* expect: LOBE-PLACEHOLDER-COPY */}
    <p>{'操作失败'}</p> {/* expect: LOBE-VAGUE-ERROR */}
    <p>{'暂无数据'}</p> {/* expect: LOBE-BARE-EMPTY */}
    <Button>确定</Button> {/* expect: LOBE-VAGUE-BUTTON */}
    <i>{value ?? 'N/A'}</i> {/* expect: LOBE-NULLISH-RENDER */}
    <i>{value ?? '—'}</i> {/* expect: LOBE-NULLISH-RENDER */}
    <li>🚀 Fast</li> {/* expect: LOBE-EMOJI-ICON */}
    <I18nProvider /> {/* expect: LOBE-I18N-PROVIDER */}
    <div className="x .ant-btn" /> {/* expect: LOBE-ANT-CLASS */}
    <ActionIcon icon={Trash2} onClick={remove} /> {/* expect: LOBE-ICON-BUTTON-LABEL */}
  </div>
);
const s = `--ant-color-border: red !important;`; // expect: LOBE-ANT-VAR-OVERRIDE
const s2 = `--lobe-color-border: red !important;`; // expect: LOBE-ANT-VAR-OVERRIDE
import { theme } from 'antd'; // expect: LOBE-ANTD-IMPORT
