import { describe, expect, it } from 'vitest';

import { processWithArtifact } from './markdown';

describe('processWithArtifact', () => {
  it('should removeLineBreaks with closed tag', () => {
    const input = `好的

<lobeArtifact identifier="sleep-interpretation-card" type="image/svg+xml" title="睡觉的新解释">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600">
<defs>
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&amp;display=swap');
</style>
</defs>
<!-- 背景 -->
<rect width="400" height="600" fill="#F0EAD6"/>
<!-- 总结 -->
<text x="200" y="500" font-family="'Noto Serif SC', serif" font-size="20" text-anchor="middle" fill="#8B4513">睡觉：生产力的假死，创造力的重生。</text>
</svg>
</lobeArtifact>`;

    const output = processWithArtifact(input);

    expect(output).toEqual(`好的

<lobeArtifact identifier="sleep-interpretation-card" type="image/svg+xml" title="睡觉的新解释"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"><defs><style>@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&amp;display=swap');</style></defs><!-- 背景 --><rect width="400" height="600" fill="#F0EAD6"/><!-- 总结 --><text x="200" y="500" font-family="'Noto Serif SC', serif" font-size="20" text-anchor="middle" fill="#8B4513">睡觉：生产力的假死，创造力的重生。</text></svg></lobeArtifact>`);
  });

  it('should removeLineBreaks with open tag', () => {
    const input = `好的

<lobeArtifact identifier="ai-interpretation-card" type="image/svg+xml" title="人工智能新解卡片">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&amp;display=swap');
    </style>
  </defs>
`;

    const output = processWithArtifact(input);

    expect(output).toEqual(`好的

<lobeArtifact identifier="ai-interpretation-card" type="image/svg+xml" title="人工智能新解卡片"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600">  <defs>    <style>      @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&amp;display=swap');    </style>  </defs>`);
  });
  it('should not throw error with empty', () => {
    const input = '';

    const output = processWithArtifact(input);

    expect(output).toEqual('');
  });

  describe('close the <lobeArtifact tag', () => {
    it('close tag for <lobeArtifact', () => {
      const input = '<lobeArtifact';

      const output = processWithArtifact(input);

      expect(output).toEqual('<lobeArtifact>');
    });

    it('close tag for <lobeArtifact identifier="something"', () => {
      const input = '<lobeArtifact identifier="something"';

      const output = processWithArtifact(input);

      expect(output).toEqual('<lobeArtifact>');
    });

    it('close tag for <lobeArtifact identifier="ai-interpretation" type="image/svg+xml" titl', () => {
      const input = '<lobeArtifact identifier="ai-interpretation" type="image/svg+xml" titl';

      const output = processWithArtifact(input);

      expect(output).toEqual('<lobeArtifact>');
    });

    it('only change the <lobeArtifact> part', () => {
      const input = `好的,让我来用新的视角解释"人工智能"这个词汇。

<lobeThinking>这个词汇涉及了当代科技和社会热点,需要用批判性和幽默感来解读其本质。我会用隐喻和讽刺来表达,同时保持简洁有力。</lobeThinking>

<lobeArtifact identifier="ai-new-interpretation" type="image/svg+xml" t`;

      const output = processWithArtifact(input);

      expect(output).toEqual(`好的,让我来用新的视角解释"人工智能"这个词汇。

<lobeThinking>这个词汇涉及了当代科技和社会热点,需要用批判性和幽默感来解读其本质。我会用隐喻和讽刺来表达,同时保持简洁有力。</lobeThinking>

<lobeArtifact>`);
    });

    it('not change for <lobeArtifact />', () => {
      const input = '<lobeArtifact/>';

      const output = processWithArtifact(input);

      expect(output).toEqual(input);
    });
  });

  it('should removeLinkBreaks for lobeThinking', () => {
    const input = `好的,让我以一个特别的视角来解释"人工智能"这个词汇。

<lobeThinking>
这个词汇涉及了当代科技和社会热点,需要用批判性、幽默而深刻的视角来解读。我会运用隐喻和讽刺,抓住其本质,并以精练的方式表达出来。这符合一个好的artifact的标准,因为它是一个独立的、可能被用户修改或重用的内容。我将创建一个新的SVG artifact来呈现这个解释。
</lobeThinking>

<lobeArtifact identifier="ai-new-interpretation" type="image/svg+xml" title="人工智能的新解释">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&amp;display=swap');
      .background { fill: #f0f0f0; }
      .title { font-family: 'Noto Serif SC', serif; font-size: 28px; font-weight: 700; fill: #333; }
      .content { font-family: 'Noto Serif SC', serif; font-size: 18px; fill: #555; }
      .divider { stroke: #999; stroke-width: 1; }
      .decoration { fill: none; stroke: #999; stroke-width: 1; }
    </style>
  </defs>
</svg>
</lobeArtifact>

我为"人工智能"这个词创建了一个新的解释,并将其呈现在一个SVG卡片中。这个解释采用了批判性和幽默的视角,试图揭示这个概念背后的一些潜在问题。`;

    const output = processWithArtifact(input);

    expect(output).toEqual(`好的,让我以一个特别的视角来解释"人工智能"这个词汇。

<lobeThinking>这个词汇涉及了当代科技和社会热点,需要用批判性、幽默而深刻的视角来解读。我会运用隐喻和讽刺,抓住其本质,并以精练的方式表达出来。这符合一个好的artifact的标准,因为它是一个独立的、可能被用户修改或重用的内容。我将创建一个新的SVG artifact来呈现这个解释。</lobeThinking>

<lobeArtifact identifier="ai-new-interpretation" type="image/svg+xml" title="人工智能的新解释"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600">  <defs>    <style>      @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&amp;display=swap');      .background { fill: #f0f0f0; }      .title { font-family: 'Noto Serif SC', serif; font-size: 28px; font-weight: 700; fill: #333; }      .content { font-family: 'Noto Serif SC', serif; font-size: 18px; fill: #555; }      .divider { stroke: #999; stroke-width: 1; }      .decoration { fill: none; stroke: #999; stroke-width: 1; }    </style>  </defs></svg></lobeArtifact>

我为"人工智能"这个词创建了一个新的解释,并将其呈现在一个SVG卡片中。这个解释采用了批判性和幽默的视角,试图揭示这个概念背后的一些潜在问题。`);
  });

  it('should removeLinkBreaks for lobeThinking', () => {
    const input = `<lobeThinking>
这个词汇涉及了
`;

    const output = processWithArtifact(input);

    expect(output).toEqual(`<lobeThinking>这个词汇涉及了`);
  });

  it('should handle no empty line between lobeThinking and lobeArtifact', () => {
    const input = `<lobeThinking>这是一个思考过程。</lobeThinking>
<lobeArtifact identifier="test" type="image/svg+xml" title="测试">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="blue"/>
</svg>
</lobeArtifact>`;

    const output = processWithArtifact(input);

    expect(output).toEqual(`<lobeThinking>这是一个思考过程。</lobeThinking>

<lobeArtifact identifier="test" type="image/svg+xml" title="测试"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">  <rect width="100" height="100" fill="blue"/></svg></lobeArtifact>`);
  });

  it('should handle Gemini case with no line break between lobeThinking and lobeArtifact tags', () => {
    const input = `<lobeThinking>这是一个思考过程。</lobeThinking><lobeArtifact identifier="test" type="image/svg+xml" title="测试">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="blue"/>
</svg>
</lobeArtifact>`;

    const output = processWithArtifact(input);

    expect(output).toEqual(`<lobeThinking>这是一个思考过程。</lobeThinking>

<lobeArtifact identifier="test" type="image/svg+xml" title="测试"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">  <rect width="100" height="100" fill="blue"/></svg></lobeArtifact>`);
  });

  it('should remove fenced code block between lobeArtifact and HTML content', () => {
    const input = `<lobeArtifact identifier="web-calculator" type="text/html" title="简单的 Web 计算器">
\`\`\`html
<!DOCTYPE html>
<html lang="zh">
<head>
  <title>计算器</title>
</head>
<body>
  <div>计算器</div>
</body>
</html>
\`\`\`
</lobeArtifact>`;

    const output = processWithArtifact(input);

    expect(output).toEqual(
      `<lobeArtifact identifier="web-calculator" type="text/html" title="简单的 Web 计算器"><!DOCTYPE html><html lang="zh"><head>  <title>计算器</title></head><body>  <div>计算器</div></body></html></lobeArtifact>`,
    );
  });

  it('should remove fenced code block between lobeArtifact and HTML content without doctype', () => {
    const input = `<lobeArtifact identifier="web-calculator" type="text/html" title="简单的 Web 计算器">
\`\`\`html
<html lang="zh">
<head>
  <title>计算器</title>
</head>
<body>
  <div>计算器</div>
</body>
</html>
\`\`\`
</lobeArtifact>`;

    const output = processWithArtifact(input);

    expect(output).toEqual(
      `<lobeArtifact identifier="web-calculator" type="text/html" title="简单的 Web 计算器"><html lang="zh"><head>  <title>计算器</title></head><body>  <div>计算器</div></body></html></lobeArtifact>`,
    );
  });

  it('should remove outer fenced code block wrapping lobeThinking and lobeArtifact', () => {
    const input =
      '```tool_code\n<lobeThinking>这是一个思考过程。</lobeThinking>\n\n<lobeArtifact identifier="test" type="text/html" title="测试">\n<div>测试内容</div>\n</lobeArtifact>\n```';

    const output = processWithArtifact(input);

    expect(output).toEqual(
      '<lobeThinking>这是一个思考过程。</lobeThinking>\n\n<lobeArtifact identifier="test" type="text/html" title="测试"><div>测试内容</div></lobeArtifact>',
    );
  });

  it('should handle both outer code block and inner HTML code block', () => {
    const input =
      '```tool_code\n<lobeThinking>这是一个思考过程。</lobeThinking>\n\n<lobeArtifact identifier="test" type="text/html" title="测试">\n```html\n<!DOCTYPE html>\n<html>\n<body>\n<div>测试内容</div>\n</body>\n</html>\n```\n</lobeArtifact>\n```';

    const output = processWithArtifact(input);

    expect(output).toEqual(
      '<lobeThinking>这是一个思考过程。</lobeThinking>\n\n<lobeArtifact identifier="test" type="text/html" title="测试"><!DOCTYPE html><html><body><div>测试内容</div></body></html></lobeArtifact>',
    );
  });

  it('should handle complete conversation with text and tags', () => {
    const input = `Sure, I can help you with that! Here is a basic calculator built using HTML, CSS, and JavaScript.

<lobeThinking>A web calculator is a substantial piece of code and a good candidate for an artifact. It's self-contained, and it's likely that the user will want to modify it. This is a new request, so I will create a new artifact.</lobeThinking>

<lobeArtifact identifier="web-calculator" type="text/html" title="Web Calculator">
\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Simple Calculator</title>
</head>
<body>
    <div>Calculator</div>
</body>
</html>
\`\`\`
</lobeArtifact>

This code provides a basic calculator that can perform addition, subtraction, multiplication, and division.`;

    const output = processWithArtifact(input);

    expect(output)
      .toEqual(`Sure, I can help you with that! Here is a basic calculator built using HTML, CSS, and JavaScript.

<lobeThinking>A web calculator is a substantial piece of code and a good candidate for an artifact. It's self-contained, and it's likely that the user will want to modify it. This is a new request, so I will create a new artifact.</lobeThinking>

<lobeArtifact identifier="web-calculator" type="text/html" title="Web Calculator"><!DOCTYPE html><html lang="en"><head>    <meta charset="UTF-8">    <title>Simple Calculator</title></head><body>    <div>Calculator</div></body></html></lobeArtifact>

This code provides a basic calculator that can perform addition, subtraction, multiplication, and division.`);
  });
});

describe('outer code block removal', () => {
  it('should remove outer html code block', () => {
    const input = `\`\`\`html
<lobeThinking>Test thinking</lobeThinking>
<lobeArtifact identifier="test" type="text/html" title="Test">
<!DOCTYPE html>
<html>
<body>Test</body>
</html>
</lobeArtifact>
\`\`\``;

    const output = processWithArtifact(input);

    expect(output).toEqual(`<lobeThinking>Test thinking</lobeThinking>

<lobeArtifact identifier="test" type="text/html" title="Test"><!DOCTYPE html><html><body>Test</body></html></lobeArtifact>`);
  });

  it('should remove outer tool_code code block', () => {
    const input = `\`\`\`tool_code
<lobeThinking>Test thinking</lobeThinking>
<lobeArtifact identifier="test" type="text/html" title="Test">
<!DOCTYPE html>
<html>
<body>Test</body>
</html>
</lobeArtifact>
\`\`\``;

    const output = processWithArtifact(input);

    expect(output).toEqual(`<lobeThinking>Test thinking</lobeThinking>

<lobeArtifact identifier="test" type="text/html" title="Test"><!DOCTYPE html><html><body>Test</body></html></lobeArtifact>`);
  });

  it('should handle input without outer code block', () => {
    const input = `<lobeThinking>Test thinking</lobeThinking>
<lobeArtifact identifier="test" type="text/html" title="Test">
<!DOCTYPE html>
<html>
<body>Test</body>
</html>
</lobeArtifact>`;

    const output = processWithArtifact(input);

    expect(output).toEqual(`<lobeThinking>Test thinking</lobeThinking>

<lobeArtifact identifier="test" type="text/html" title="Test"><!DOCTYPE html><html><body>Test</body></html></lobeArtifact>`);
  });

  it('should handle code block with content before and after', () => {
    const input = `Some text before

\`\`\`html
<lobeThinking>Test thinking</lobeThinking>

<lobeArtifact identifier="test" type="text/html" title="Test">
<!DOCTYPE html>
<html>
<body>Test</body>
</html>
</lobeArtifact>
\`\`\`

Some text after`;

    const output = processWithArtifact(input);

    expect(output).toEqual(`Some text before

<lobeThinking>Test thinking</lobeThinking>

<lobeArtifact identifier="test" type="text/html" title="Test"><!DOCTYPE html><html><body>Test</body></html></lobeArtifact>

Some text after`);
  });

  it('should handle code block with only lobeArtifact tag', () => {
    const input = `\`\`\`html
<lobeArtifact identifier="test" type="text/html" title="Test">
<!DOCTYPE html>
<html>
<body>Test</body>
</html>
</lobeArtifact>
\`\`\``;

    const output = processWithArtifact(input);

    expect(output).toEqual(
      `<lobeArtifact identifier="test" type="text/html" title="Test"><!DOCTYPE html><html><body>Test</body></html></lobeArtifact>`,
    );
  });

  it('should handle code block with surrounding text and both lobeThinking and lobeArtifact', () => {
    const input = `---

\`\`\`tool_code
<lobeThinking>The user reported a \`SyntaxError\` in the browser console, indicating a problem with the JavaScript code in the calculator artifact. The error message "Identifier 'display' has already been declared" suggests a variable naming conflict. I need to review the JavaScript code and correct the issue. This is an update to the existing "calculator-web-artifact" artifact.</lobeThinking>
<lobeArtifact identifier="calculator-web-artifact" type="text/html" title="Simple Calculator">
<!DOCTYPE html>
<html lang="en">
...
</html>
</lobeArtifact>
\`\`\`
I've updated the calculator artifact. The issue was a naming conflict with the \`display\` variable. I've renamed the input element's ID to \`calc-display\` and the JavaScript variable to \`displayElement\` to avoid the conflict. The calculator should now function correctly.

---`;

    const output = processWithArtifact(input);

    expect(output).toEqual(`---

<lobeThinking>The user reported a \`SyntaxError\` in the browser console, indicating a problem with the JavaScript code in the calculator artifact. The error message "Identifier 'display' has already been declared" suggests a variable naming conflict. I need to review the JavaScript code and correct the issue. This is an update to the existing "calculator-web-artifact" artifact.</lobeThinking>

<lobeArtifact identifier="calculator-web-artifact" type="text/html" title="Simple Calculator"><!DOCTYPE html><html lang="en">...</html></lobeArtifact>

I've updated the calculator artifact. The issue was a naming conflict with the \`display\` variable. I've renamed the input element's ID to \`calc-display\` and the JavaScript variable to \`displayElement\` to avoid the conflict. The calculator should now function correctly.

---`);
  });

  it('should handle code block before lobeThinking and lobeArtifact', () => {
    const input = `
Okay, I'll create a temperature converter with the logic wrapped in an IIFE and event listeners attached in Javascript.

\`\`\`html
<!DOCTYPE html>
<html lang="en">
...
</html>
\`\`\`

<lobeThinking>This is a good candidate for an artifact. It's a self-contained HTML document with embedded JavaScript that provides a functional temperature converter. It's more than a simple code snippet and can be reused or modified. This is a new request, so I'll create a new artifact with the identifier "temperature-converter".</lobeThinking>

<lobeArtifact identifier="temperature-converter" type="text/html" title="Temperature Converter">
\`\`\`html
<!DOCTYPE html>
<html lang="en">
...
</html>
\`\`\`
</lobeArtifact>
This HTML document includes the temperature converter with the requested features: the logic is wrapped in an IIFE, and event listeners are attached in JavaScript.
`;

    const output = processWithArtifact(input);

    expect(output)
      .toEqual(`Okay, I'll create a temperature converter with the logic wrapped in an IIFE and event listeners attached in Javascript.

\`\`\`html
<!DOCTYPE html>
<html lang="en">
...
</html>
\`\`\`

<lobeThinking>This is a good candidate for an artifact. It's a self-contained HTML document with embedded JavaScript that provides a functional temperature converter. It's more than a simple code snippet and can be reused or modified. This is a new request, so I'll create a new artifact with the identifier "temperature-converter".</lobeThinking>

<lobeArtifact identifier="temperature-converter" type="text/html" title="Temperature Converter"><!DOCTYPE html><html lang="en">...</html></lobeArtifact>

This HTML document includes the temperature converter with the requested features: the logic is wrapped in an IIFE, and event listeners are attached in JavaScript.`);
  });

  describe('idempotency tests', () => {
    it('should not add extra blank lines when running processWithArtifact multiple times', () => {
      const input = `<lobeThinking>这是一个思考过程。</lobeThinking><lobeArtifact identifier="test" type="image/svg+xml" title="测试">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="blue"/>
</svg>
</lobeArtifact>`;

      // First run
      const firstRun = processWithArtifact(input);

      // Second run - should produce the same result
      const secondRun = processWithArtifact(firstRun);

      // Third run - should still produce the same result
      const thirdRun = processWithArtifact(secondRun);

      // All runs should produce the same output
      expect(firstRun).toEqual(secondRun);
      expect(secondRun).toEqual(thirdRun);

      // Verify the output has exactly two newlines between tags
      expect(firstRun).toContain('</lobeThinking>\n\n<lobeArtifact');
      expect(firstRun.match(/(<\/lobeThinking>)\n\n(<lobeArtifact)/)).toBeTruthy();
    });

    it('should handle already processed content with proper spacing', () => {
      const alreadyProcessed = `<lobeThinking>这是一个思考过程。</lobeThinking>

<lobeArtifact identifier="test" type="image/svg+xml" title="测试"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">  <rect width="100" height="100" fill="blue"/></svg></lobeArtifact>`;

      const result = processWithArtifact(alreadyProcessed);

      // Should remain unchanged
      expect(result).toEqual(alreadyProcessed);
    });

    it('should not convert spaces between tags into extra blank lines', () => {
      const inputWithSpaces = `<lobeThinking>这是一个思考过程。</lobeThinking> <lobeArtifact identifier="test" type="image/svg+xml" title="测试">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="blue"/>
</svg>
</lobeArtifact>`;

      const output = processWithArtifact(inputWithSpaces);

      // Should still have the space and not convert it to newlines
      expect(output).toContain('</lobeThinking> <lobeArtifact');
      expect(output).not.toContain('</lobeThinking>\n\n<lobeArtifact');
    });
  });
});
