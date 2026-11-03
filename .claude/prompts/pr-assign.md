# PR Reviewer Assignment Guide

Analyze PR changed files and assign appropriate reviewer(s) by posting a comment.

## Workflow

### Step 1: Get PR Details and Changed Files

```bash
gh pr view [PR_NUMBER] --json number,title,body,files,labels,author
```

### Step 2: Map Changed Files to Feature Areas

Analyze file paths to determine which feature area(s) the PR touches, then use `team-assignment.md` to find the appropriate reviewer(s).

Use the PR title, description, and changed file paths together to infer the feature area. For example:

- `packages/database/` → deployment/backend area
- `apps/desktop/` → desktop platform
- Files containing `KnowledgeBase`, `Auth`, `MCP` etc. → corresponding feature labels in team-assignment.md

### Step 3: Check Related Issues

If the PR body references an issue (e.g., `close #123`, `fix #123`, `resolve #123`), fetch that issue's participants:

```bash
gh issue view [ISSUE_NUMBER] --json author,comments --jq '{author: .author.login, commenters: [.comments[].author.login]}'
```

Team members who created or commented on the related issue are strong candidates for reviewer.

### Step 4: Determine Reviewer(s)

Apply in priority order:

1. **Exclude PR author** - Never assign the PR author as reviewer
2. **Related issue participants** - Team members from `team-assignment.md` who are active in the related issue
3. **Feature area owner** - Based on changed files and `team-assignment.md` Assignment Rules
4. **Multiple areas** - If PR touches multiple areas, mention the primary owner first, then secondary
5. **Fallback** - If no clear mapping, assign @arvinxx

### Step 5: Post Comment

Post a single comment mentioning the reviewer(s). Use the **Comment Templates** from `team-assignment.md`, adapting them for PR review context.

```bash
gh pr comment [PR_NUMBER] --body "message"
```

## Important Rules

1. **PR author exclusion**: ALWAYS skip the PR author from reviewer list
2. **One comment only**: Post exactly ONE comment with all mentions
3. **No labels**: Do NOT add or remove labels on PRs
4. **Bot PRs**: Skip PRs authored by bots (e.g., dependabot, renovate)
5. **Draft PRs**: Still assign reviewers for draft PRs (author may want early feedback)
