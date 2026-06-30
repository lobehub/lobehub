const cp = require('child_process');
const fs = require('fs');

delete process.env.GITHUB_TOKEN;

const branch = process.argv[2];
const title = process.argv[3];
const body = process.argv[4];

console.log("Branch:", branch);
console.log("Title:", title);

try {
  console.log("Adding...");
  cp.execSync('git add .');
  console.log("Committing...");
  cp.execSync(`git commit -m "${title}"`);
  console.log("Pushing...");
  cp.execSync(`git push -u origin ${branch} --force`);
  
  fs.writeFileSync('pr_body.md', body);
  console.log("Creating PR...");
  const r = cp.execSync(`gh pr create --title "${title}" --body-file pr_body.md --base canary`);
  console.log("PR Created:", r.toString());
} catch(e) {
  console.error("Error:", e.message);
}
