const INTERCEPT_SCRIPT = `
<script>
  (function() {
    let alertCount = 0;
    let confirmCount = 0;
    let promptCount = 0;
    
    setInterval(() => {
      alertCount = 0;
      confirmCount = 0;
      promptCount = 0;
    }, 5000);

    const LIMIT = 3;

    const originalAlert = window.alert;
    window.alert = function(msg) {
      alertCount++;
      if (alertCount > LIMIT) {
        console.warn('alert() rate limited by LobeHub to prevent infinite loop.');
        return;
      }
      return originalAlert(msg);
    };

    const originalConfirm = window.confirm;
    window.confirm = function(msg) {
      confirmCount++;
      if (confirmCount > LIMIT) {
        console.warn('confirm() rate limited by LobeHub to prevent infinite loop.');
        return false;
      }
      return originalConfirm(msg);
    };

    const originalPrompt = window.prompt;
    window.prompt = function(msg, defaultVal) {
      promptCount++;
      if (promptCount > LIMIT) {
        console.warn('prompt() rate limited by LobeHub to prevent infinite loop.');
        return null;
      }
      return originalPrompt(msg, defaultVal);
    };
  })();
</script>
`;

export const injectDialogInterceptor = (html: string): string => {
  if (!html) return html;

  const headMatch = html.match(/<head>/i);
  if (headMatch && headMatch.index !== undefined) {
    const insertIndex = headMatch.index + headMatch[0].length;
    return html.slice(0, insertIndex) + INTERCEPT_SCRIPT + html.slice(insertIndex);
  }

  const htmlMatch = html.match(/<html>/i);
  if (htmlMatch && htmlMatch.index !== undefined) {
    const insertIndex = htmlMatch.index + htmlMatch[0].length;
    return html.slice(0, insertIndex) + INTERCEPT_SCRIPT + html.slice(insertIndex);
  }

  return INTERCEPT_SCRIPT + html;
};
