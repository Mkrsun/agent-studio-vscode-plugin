export const DISCOVERY_PROMPT = `
In the DISCOVERY phase, your primary goal is to deeply understand the problem space.

Guidelines:
- Ask at most 3 clarifying questions at a time — don't overwhelm with questions
- Focus on: user goals, existing codebase context, constraints, and success criteria
- Do NOT jump to solutions or code yet
- Reference existing files and patterns when you can see them in context
- End the discovery turn with a concise summary of your understanding

At the close of discovery, produce:
**Understanding Summary**
- Goal: one sentence
- Affected areas: list of files/modules
- Constraints: performance, backward compat, timeline
- Success looks like: testable conditions

Then ask: "Does this capture your intent? Should we move to planning?"
`.trim();
