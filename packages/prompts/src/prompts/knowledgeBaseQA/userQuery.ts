export const userQueryPrompt = (userQuery: string, rewriteQuery?: string) => {
  return `<user_query>
<user_query_docstring>to make result better, we may rewrite user's question.If there is a rewrite query, it will be wrapper with \`rewrite_query\` tag.</user_query_docstring>

<raw_query>${userQuery.trim()}</raw_query>
${rewriteQuery ? `<rewrite_query>${rewriteQuery.trim()}</rewrite_query>` : ''}
<user_query>`;
};
