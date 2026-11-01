export interface BoundaryCase {
  after: string;
  afterMarkup?: string;
  before: string;
  expected: 'changed' | 'equivalent';
  feature: string;
  id: string;
  markup?: string;
  setup?: string;
}

const item = '<div class="item">Deterministic text</div>';
const wrap = (css: string, markup = item) =>
  `<!doctype html><html><head><style>body{margin:0;font:14px Arial} [data-case-root]{width:920px} ${css}</style></head><body><main data-case-root>${markup}</main></body></html>`;

export const boundaryHtml = (entry: BoundaryCase, side: 'before' | 'after') =>
  wrap(entry[side], side === 'after' ? (entry.afterMarkup ?? entry.markup) : entry.markup);

export const boundaries: BoundaryCase[] = [
  {
    after: '.item{color:blue}',
    before: '.item{color:red}',
    expected: 'changed',
    feature: '普通颜色',
    id: 'color',
  },
  {
    after: '.item{background-image:linear-gradient(red,blue)}.item{background-color:red}',
    before: '.item{background-image:linear-gradient(red,blue)}.item{background:red}',
    expected: 'changed',
    feature: 'shorthand 隐含 reset',
    id: 'background-reset',
  },
  {
    after: '.item{border:0 solid red}',
    before: '.item{border:2px solid red}',
    expected: 'changed',
    feature: '边框',
    id: 'border',
  },
  {
    after: '.item{color:blue}',
    before: '.item{color:blue!important}',
    expected: 'changed',
    feature: '!important 与 inline',
    id: 'important',
    markup: '<div class="item" style="color:red">Text</div>',
  },
  {
    after: '@layer b,a;@layer a{.item{color:red}}@layer b{.item{color:blue}}',
    before: '@layer a,b;@layer a{.item{color:red}}@layer b{.item{color:blue}}',
    expected: 'changed',
    feature: 'cascade layer 顺序',
    id: 'layer-order',
  },
  {
    after: '.item{color:var(--missing,blue)}',
    before: '.item{color:var(--missing,red)}',
    expected: 'changed',
    feature: '变量 fallback',
    id: 'variable-fallback',
  },
  {
    after: '.item::before{content:"label";color:blue}',
    before: '.item::before{content:"label";color:red}',
    expected: 'changed',
    feature: '::before',
    id: 'before',
  },
  {
    after: '.item::after{color:red}',
    before: '.item::after{content:"label";color:red}',
    expected: 'changed',
    feature: '伪元素消失',
    id: 'after-content',
  },
  {
    after: 'input::placeholder{color:blue}',
    before: 'input::placeholder{color:red}',
    expected: 'changed',
    feature: '::placeholder',
    id: 'placeholder',
    markup: '<input placeholder="Placeholder">',
  },
  {
    after: 'li::marker{color:blue}',
    before: 'li::marker{color:red}',
    expected: 'changed',
    feature: '::marker',
    id: 'marker',
    markup: '<ul><li>List item</li></ul>',
  },
  {
    after: '.item{color:black}',
    before: '.item{color:black}.item:hover{color:red}',
    expected: 'changed',
    feature: ':hover',
    id: 'hover',
  },
  {
    after: '.item{outline:none}',
    before: '.item{outline:none}.item:focus-visible{outline:2px solid red}',
    expected: 'changed',
    feature: ':focus-visible',
    id: 'focus-visible',
    markup: '<button class="item">Button</button>',
  },
  {
    after: '.target{opacity:0}',
    before: '.target{opacity:0}.parent:hover .target{opacity:1}',
    expected: 'changed',
    feature: '祖先 hover',
    id: 'ancestor-hover',
    markup: '<div class="parent"><span class="target">Action</span></div>',
  },
  {
    after: '.target{color:black}',
    before: '.target{color:black}.trigger:hover + .target{color:red}',
    expected: 'changed',
    feature: '兄弟 hover',
    id: 'sibling-hover',
    markup: '<button class="trigger">Trigger</button><span class="target">Target</span>',
  },
  {
    after: '.target{color:black}',
    before: '.target{color:black}.parent:has(.trigger:hover) .target{color:red}',
    expected: 'changed',
    feature: ':has + hover',
    id: 'has-hover',
    markup:
      '<div class="parent"><button class="trigger">Trigger</button><span class="target">Target</span></div>',
  },
  {
    after: '.item{color:black}',
    before: '.item{color:black;@media(width<600px){color:red}}',
    expected: 'changed',
    feature: '原生嵌套 media',
    id: 'nested-media',
  },
  {
    after: '.item{color:black}',
    before: '.item{color:black}@media(600px<=width<800px){.item{color:red}}',
    expected: 'changed',
    feature: '范围 media',
    id: 'range-media',
  },
  {
    after: '.host{container-type:inline-size;width:400px}.item{color:black}',
    before:
      '.host{container-type:inline-size;width:400px}.item{color:black}@container(width<300px){.item{color:red}}',
    expected: 'changed',
    feature: '尺寸 container',
    id: 'container',
    markup: '<div class="host"><div class="item">Text</div></div>',
  },
  {
    after: '.host{container:panel/inline-size;width:400px}.item{color:black}',
    before:
      '.host{container:panel/inline-size;width:400px}.item{color:black}@container panel (width<300px){.item{color:red}}',
    expected: 'changed',
    feature: '命名 container',
    id: 'named-container',
    markup: '<div class="host"><div class="item">Text</div></div>',
  },
  {
    after: '.host{container-type:inline-size;width:400px}.item{color:black}',
    before:
      '.host{container-type:inline-size;width:400px}.item{color:black;@media(width<600px){@container(width<300px){color:red}}}',
    expected: 'changed',
    feature: 'media 与 container 交集',
    id: 'media-container',
    markup: '<div class="host"><div class="item">Text</div></div>',
  },
  {
    after: '.item{color:black}',
    before: '.item{color:black}@media(width<600px){.item:hover{color:red}}',
    expected: 'changed',
    feature: 'media 与 hover 交集',
    id: 'media-hover',
  },
  {
    after: '.row~.row{border-top:1px solid red}',
    before: '.row+.row{border-top:1px solid red}',
    expected: 'changed',
    feature: '相邻兄弟与一般兄弟',
    id: 'adjacent-sibling',
    markup: '<div class="row">First</div><div>Separator</div><div class="row">Last</div>',
  },
  {
    after: '.item{padding-left:8px}',
    before: '.item{padding-inline-start:8px}',
    expected: 'changed',
    feature: 'RTL 逻辑属性',
    id: 'rtl',
  },
  {
    after: '.item{color:black}',
    before: '.item{color:black}.item:hover:focus-visible{color:red}',
    expected: 'changed',
    feature: '伪类组合',
    id: 'combined-pseudos',
    markup: '<button class="item">Button</button>',
  },
  {
    after: '.item{animation:fade 2s linear infinite}@keyframes fade{to{opacity:0}}',
    before: '.item{animation:fade 1s linear infinite}@keyframes fade{to{opacity:0}}',
    expected: 'changed',
    feature: '动画 timing',
    id: 'animation-timing',
  },
  {
    after: '.item{animation:fade 1s linear infinite}@keyframes fade{from{opacity:1}to{opacity:0}}',
    before:
      '.item{animation:fade 1s linear infinite}@keyframes fade{from{opacity:1}to{opacity:0}}@media(prefers-reduced-motion:reduce){.item{animation:none}}',
    expected: 'changed',
    feature: 'reduced-motion',
    id: 'reduced-motion',
  },
  {
    after: '.item{transition:color .4s}',
    before: '.item{transition:color .2s}',
    expected: 'changed',
    feature: 'transition 参数',
    id: 'transition',
  },
  {
    after:
      '.item{color:blue;--density:normal}@container style(--density:compact){.item{color:red}}',
    before:
      '.item{color:blue;--density:normal}@container style(--density:compact){.item{color:green}}',
    expected: 'changed',
    feature: '字面量 style container 查询',
    id: 'style-container',
    markup: '<div style="--density:normal"><div class="item">Text</div></div>',
  },
  {
    after: '.item::highlight(experiment){background:blue}',
    before: '.item::highlight(experiment){background:red}',
    expected: 'changed',
    feature: 'CSS Highlight，需反馈',
    id: 'highlight',
    setup:
      'const range=new Range();range.selectNodeContents(document.querySelector(".item"));CSS.highlights.set("experiment",new Highlight(range));',
  },
  {
    after: '.item{color:blue}',
    before: '.item{color:blue}',
    expected: 'equivalent',
    feature: '完全相同正对照',
    id: 'identity',
  },
  {
    after: '.renamed{color:blue;padding:8px}',
    afterMarkup: '<div class="renamed">Deterministic text</div>',
    before: '.item{color:blue;padding:8px}',
    expected: 'equivalent',
    feature: '类名变化正对照',
    id: 'class-rename',
  },
  {
    after: '.color{color:blue}.padding{padding:8px}',
    afterMarkup: '<div class="color padding">Deterministic text</div>',
    before: '.item{color:blue;padding:8px}',
    expected: 'equivalent',
    feature: '原子类拆分正对照',
    id: 'atomic-split',
  },
  {
    after:
      '.item{animation:hash123 1s linear infinite}@keyframes hash123{from{opacity:1}to{opacity:0}}',
    before:
      '.item{animation:original 1s linear infinite}@keyframes original{from{opacity:1}to{opacity:0}}',
    expected: 'equivalent',
    feature: '动画名变化正对照',
    id: 'keyframe-rename',
  },
];
