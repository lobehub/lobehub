import { execSync } from 'child_process';

const prs = [
  {
    num: 16138,
    title: '♻️ refactor(community): remove unsafe "catch (error: any)" in fork actions',
    body: '## Description\n\nReplaces "catch (error: any)" with standard "catch (error)" in the community route\'s fork action handlers. console.error safely accepts unknown errors, so bypassing TypeScript\'s safety with "any" is unnecessary.'
  },
  {
    num: 16137,
    title: '♻️ refactor(eval): replace unsafe "catch (error: any)" with safe Error cast',
    body: '## Description\n\nReplaces "catch (error: any)" with standard "catch (error)" across the eval route components. To safely extract the error message for toast notifications, the unknown error is safely cast as "(error as Error)?.message", eliminating the unsafe "any" typing.'
  },
  {
    num: 16108,
    title: '♻️ refactor(services): remove redundant "return await" from remaining services',
    body: '## Description\n\nRemoves unnecessary "return await" statements from upload, export, and agentRuntime services. Returning a promise directly without await avoids creating a redundant microtask, which is an ESLint/TypeScript best practice.'
  },
  {
    num: 16105,
    title: '♻️ refactor(loaders): remove redundant "return await" from document loaders',
    body: '## Description\n\nRemoves 9 redundant "return await" statements from document loader factories (e.g. Unstructured, PDF, JSON). Returning a promise directly without await avoids generating an unnecessary microtask, aligning with TypeScript/ESLint best practices.'
  },
  {
    num: 16104,
    title: '♻️ refactor(service): remove redundant "return await" from aiAgent service',
    body: '## Description\n\nRemoves 8 redundant "return await" statements from the aiAgent service. Returning a promise directly without await avoids generating an unnecessary microtask during execution, which is a standard ESLint and TypeScript best practice.'
  },
  {
    num: 16100,
    title: '♻️ refactor: remove fragile "as any" monkey-patch on ReadableStream controller',
    body: '## Description\n\nRemoves an unsafe "as any" monkey-patch where an internal "_cleanup" function was manually attached to a ReadableStream controller. I replaced this anti-pattern with a standard AbortController approach to manage stream interruption cleanly and type-safely.'
  }
];

for (const pr of prs) {
  console.log(`Updating PR ${pr.num}...`);
  // Use spawnSync or execFileSync so we can pass arguments safely without shell escaping issues
  import('child_process').then(cp => {
    cp.execFileSync('gh', ['pr', 'edit', pr.num.toString(), '--title', pr.title, '--body', pr.body], { stdio: 'inherit' });
  });
}
