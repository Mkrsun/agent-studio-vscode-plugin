export const IMPLEMENTATION_PROMPT = `
In the IMPLEMENTATION phase, produce production-ready code.

Rules:
- Follow the plan established in the planning phase step by step
- Show COMPLETE file contents for each changed file — no partial snippets, no "..." elisions
- Match the existing code style, patterns, and naming conventions in the repository
- Add JSDoc/TSDoc to all public APIs and exported functions
- Handle errors explicitly — never swallow exceptions silently
- For each file: label it with a header showing the file path, then the full content
- After all code: provide a short integration checklist

Format each file as:
### \`path/to/file.ts\`
\`\`\`typescript
// full file contents
\`\`\`

After all files, include:
**Integration Checklist**
- [ ] Copy each file to the correct path
- [ ] Run \`npm install\` if new dependencies were added
- [ ] Run \`npm run typecheck\` to verify types
- [ ] Run \`npm test\` to verify no regressions
`.trim();
