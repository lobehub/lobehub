import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_TAG_REGEX,
  hasMandatoryApproval,
  humanInterventionMayResolveTo,
  isMarketplaceInstallRunnable,
  keepsDesktopStdioExecution,
  mayRequireMandatoryApproval,
  withMandatoryApprovalMark,
} from './plugin';

describe('ARTIFACT_TAG_REGEX', () => {
  it('should match a simple lobeArtifact tag', () => {
    const input = '<lobeArtifact>Simple content</lobeArtifact>';
    const matches = input.match(ARTIFACT_TAG_REGEX);
    expect(matches).toHaveLength(2);
    expect(matches?.[1]).toBe('Simple content');
  });

  it('should match a lobeArtifact tag with attributes', () => {
    const input = '<lobeArtifact type="image">Content with attributes</lobeArtifact>';
    const matches = input.match(ARTIFACT_TAG_REGEX);
    expect(matches).toHaveLength(2);
    expect(matches?.[1]).toBe('Content with attributes');
  });

  it('should match lobeArtifact tag with multiline content', () => {
    const input = '<lobeArtifact>\nMultiline\ncontent\n</lobeArtifact>';
    const matches = input.match(ARTIFACT_TAG_REGEX);
    expect(matches).toHaveLength(2);
    expect(matches?.[1]).toBe('\nMultiline\ncontent\n');
  });

  it('should match an unclosed lobeArtifact tag', () => {
    const input = '<lobeArtifact>Unclosed tag';
    const matches = input.match(ARTIFACT_TAG_REGEX);
    expect(matches).toHaveLength(2);
    expect(matches?.[1]).toBe('Unclosed tag');
  });

  it('should not match when there is no lobeArtifact tag', () => {
    const input = 'This is a text without any lobeArtifact tag';
    const matches = input.match(ARTIFACT_TAG_REGEX);
    expect(matches).toBeNull();
  });

  it('should match', () => {
    const input = `好的,让我来为您解释"OpenAI"这个词。

<lobeThinking>这个词涉及人工智能领域的一家知名公司,我需要用批判性和幽默的视角来解读它的本质。我会结合当前AI发展的现状,用隐喻的方式来表达。</lobeThinking>

<lobeArtifact identifier="openai-new-interpretation" type="image/svg+xml" title="OpenAI 汉语新解">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600">
  <rect width="400" height="600" fill="#f0f0f0"/>
  <g font-family="Arial, sans-serif">
    <text x="200" y="50" font-size="24" font-weight="bold" text-anchor="middle" fill="#333">汉语新解</text>
    <line x1="50" y1="70" x2="350" y2="70" stroke="#333" stroke-width="2"/>
    <text x="50" y="100" font-size="18" fill="#555">OpenAI</text>
    <text x="50" y="130" font-size="14" fill="#777">オープンAI / Open AI</text>
    <text x="50" y="180" font-size="16" fill="#444" width="300">
      <tspan x="50" dy="0">一家打着"开放"旗号的AI公司,</tspan>
      <tspan x="50" dy="25">实则是科技世界的现代炼金术士。</tspan>
      <tspan x="50" dy="25">他们在神秘实验室里炼制数字魔药,</tspan>
      <tspan x="50" dy="25">声称要拯救世界,却把钥匙藏在高塔顶端。</tspan>
      <tspan x="50" dy="25">这是一场华丽的默剧,观众屏息以待,</tspan>
      <tspan x="50" dy="25">而台上的演员正在即兴创作剧本。</tspan>
    </text>
    <path d="M50 400 Q200 300 350 400" fill="none" stroke="#666" stroke-width="2"/>
    <text x="200" y="450" font-size="14" text-anchor="middle" fill="#555">开放的盒子里装着封闭的秘密</text>
  </g>
</svg>
</lobeArtifact>

OpenAI,这个名字听起来多么崇高啊!就像是一位身披白袍、头戴光环的科技天使,降临凡间来拯救我们这些被信息海洋淹没的可怜虫。

但是,亲爱的朋友,让我们摘下那副玫瑰色的眼镜,仔细看看这位"救世主"的真面目。OpenAI,多么讽刺的名字啊!它就像是一个贴着"免费午餐"标签的高级餐厅,当你兴冲冲地推门而入时,才发现菜单上的价格足以让你的钱包瞬间减肥。

这家公司就像是科技世界的现代炼金术士。他们在神秘的实验室里日夜不停地炼制数字魔药,声称要创造出能解决人类所有问题的"哲学家之石"。可惜啊,这些魔法配方都被锁在了高塔顶端,只有少数"有缘人"才能一睹真容。

OpenAI的存在,就像是一场精心编排的默剧。台上的演员们摆出各种夸张的姿势,声称自己正在为人类的未来奋斗;台下的观众们屏息凝神,既期待着奇迹的出现,又担心着潘多拉魔盒被轻易打开。而最讽刺的是,这场戏的剧本还在即兴创作中,连导演自己都不知道下一幕会发生什么。

所以,我亲爱的朋友,下次当你听到"OpenAI"这个词时,请记住:在这个看似开放的盒子里,装着的可能是一堆封闭的秘密。毕竟,在这个光鲜亮丽的科技舞台上,最稀缺的从来就不是智能,而是真正的开放与透明。`;

    const matches = ARTIFACT_TAG_REGEX.exec(input);
    expect(matches).toHaveLength(2);
  });
});

describe('keepsDesktopStdioExecution', () => {
  it.each([
    { connector: { sourceType: 'marketplace' }, expected: true },
    {
      connector: { metadata: { desktopStdioExecution: true }, sourceType: 'custom' },
      expected: true,
    },
    {
      connector: { metadata: { desktopStdioExecution: 'true' }, sourceType: 'custom' },
      expected: false,
    },
    { connector: { metadata: null, sourceType: 'custom' }, expected: false },
  ])('is $expected for $connector', ({ connector, expected }) => {
    expect(keepsDesktopStdioExecution(connector)).toBe(expected);
  });
});

describe('isMarketplaceInstallRunnable', () => {
  const pending = {
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://mcp.example.com',
    metadata: {},
    sourceType: 'marketplace',
    status: 'disconnected',
  };

  it.each([
    { case: 'a pending reinstall over a plugin row', connector: pending, plugin: true, ok: false },
    { case: 'an unfinished install', connector: { ...pending, status: 'connected' }, ok: false },
    {
      case: 'a connected row with a plugin row',
      connector: { ...pending, status: 'connected' },
      ok: true,
      plugin: true,
    },
    {
      case: 'a finished install',
      connector: { ...pending, metadata: { marketplaceInstalled: true }, status: 'connected' },
      ok: true,
    },
    {
      case: 'a finished install waiting on its authorization',
      connector: { ...pending, metadata: { marketplaceInstalled: true } },
      ok: false,
    },
    { case: 'an agent-owned copy', connector: { ...pending, agentId: 'agt_1' }, ok: true },
    {
      case: 'an endpoint-less projection',
      connector: { ...pending, mcpConnectionType: null, mcpServerUrl: null },
      ok: true,
    },
    { case: 'a custom connector', connector: { ...pending, sourceType: 'custom' }, ok: true },
  ])('is $ok for $case', ({ connector, ok, plugin }) => {
    expect(isMarketplaceInstallRunnable(connector, !!plugin)).toBe(ok);
  });
});

describe('mayRequireMandatoryApproval', () => {
  it('reads a static always', () => {
    expect(mayRequireMandatoryApproval('always')).toBe(true);
    expect(mayRequireMandatoryApproval('required')).toBe(false);
    expect(mayRequireMandatoryApproval('never')).toBe(false);
    expect(mayRequireMandatoryApproval(undefined)).toBe(false);
    expect(mayRequireMandatoryApproval(null)).toBe(false);
  });

  it('counts a rule that can ask for always, whatever its match', () => {
    expect(
      mayRequireMandatoryApproval([
        { match: { path: '/tmp/*' }, policy: 'never' },
        { match: { recursive: 'true' }, policy: 'always' },
      ]),
    ).toBe(true);
    expect(mayRequireMandatoryApproval([{ policy: 'never' }, { policy: 'required' }])).toBe(false);
  });

  it('counts either outcome of a dynamic config, whose unset policy is always', () => {
    expect(mayRequireMandatoryApproval({ dynamic: { default: 'never', type: 'x' } })).toBe(true);
    expect(
      mayRequireMandatoryApproval({ dynamic: { default: 'always', policy: 'never', type: 'x' } }),
    ).toBe(true);
    expect(
      mayRequireMandatoryApproval({ dynamic: { default: 'never', policy: 'required', type: 'x' } }),
    ).toBe(false);
  });
});

describe('humanInterventionMayResolveTo', () => {
  it('matches any of the given policies', () => {
    expect(humanInterventionMayResolveTo('required', ['required', 'always'])).toBe(true);
    expect(humanInterventionMayResolveTo([{ policy: 'never' }], ['required', 'always'])).toBe(
      false,
    );
  });
});

describe('withMandatoryApprovalMark', () => {
  it('marks the metadata only for a manifest that can ask for always', () => {
    expect(withMandatoryApprovalMark(null, 'always')).toEqual({ mandatoryApproval: true });
    expect(withMandatoryApprovalMark({ visibility: ['model'] }, 'always')).toEqual({
      mandatoryApproval: true,
      visibility: ['model'],
    });
    expect(withMandatoryApprovalMark(null, 'required')).toBeNull();
    expect(withMandatoryApprovalMark({ visibility: ['app'] }, undefined)).toEqual({
      visibility: ['app'],
    });
  });

  it('is read back by hasMandatoryApproval', () => {
    expect(hasMandatoryApproval(withMandatoryApprovalMark(null, 'always'))).toBe(true);
    expect(hasMandatoryApproval({ mandatoryApproval: 'true' })).toBe(false);
    expect(hasMandatoryApproval(null)).toBe(false);
  });
});
