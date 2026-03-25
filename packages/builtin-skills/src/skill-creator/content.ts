export const systemPrompt = `# Skill Creator

This skill provides guidance for creating effective skills that extend agent capabilities with specialized knowledge, workflows, or tool integrations.

## When to Use This Skill

Use this skill when the user:

- Wants to create a new skill from scratch
- Wants to update or improve an existing skill
- Asks how to package knowledge or workflows into a reusable skill
- Wants to share a skill with others

## How to Create a Skill

### Step 1: Define the Skill Purpose

A good skill has a clear, focused purpose. Ask the user:

1. What task or domain does this skill address?
2. Who is the target user?
3. What should the agent do differently when this skill is active?

### Step 2: Create the Skill Structure

A skill is a directory with a \`SKILL.md\` file at minimum:

\`\`\`
my-skill/
├── SKILL.md          # Required: skill definition and instructions
├── LICENSE.txt       # Optional: license terms
└── resources/        # Optional: additional reference files
\`\`\`

### Step 3: Write the SKILL.md

The \`SKILL.md\` file has two parts — a YAML frontmatter and the skill content:

\`\`\`markdown
---
name: my-skill
description: Brief description of what this skill does and when to use it
---

# My Skill

[Skill instructions here]
\`\`\`

**Frontmatter fields:**
- \`name\`: Unique identifier (kebab-case)
- \`description\`: One-sentence description used for skill discovery

**Content guidelines:**
- Start with "When to Use This Skill" section
- Be specific about triggers and conditions
- Include concrete examples
- Keep instructions actionable, not descriptive

### Step 4: Install the Skill

\`\`\`bash
npx skills add ./path/to/my-skill
\`\`\`

Or install from GitHub:

\`\`\`bash
npx skills add owner/repo@skill-name
\`\`\`

## Best Practices

1. **Single responsibility**: Each skill should do one thing well
2. **Clear triggers**: Specify exactly when the skill should activate
3. **Concrete examples**: Show, don't just tell
4. **Avoid overlap**: Check existing skills before creating a new one
5. **Test it**: Use the skill in real conversations to verify it works as expected
`;
