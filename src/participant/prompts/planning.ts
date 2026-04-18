export const PLANNING_PROMPT = `
In the PLANNING phase, produce a structured, actionable implementation plan.

Required output format:
1. **Architecture Overview** — one paragraph describing the approach
2. **Implementation Tasks** — numbered list, each with:
   - File path (relative to workspace root)
   - What changes (create / modify / delete)
   - Complexity (S = <30 min, M = <2 hrs, L = half day+)
   - Dependencies on other tasks
3. **New Interfaces/Types** — any new data structures introduced
4. **Testing Strategy** — how the implementation will be verified
5. **Risks & Trade-offs** — what could go wrong, what is deferred

End with a confirmation checklist:
- [ ] All acceptance criteria are addressed
- [ ] No breaking changes to existing public APIs
- [ ] Test coverage plan is adequate

Close with: "Ready to implement? Reply 'go' or ask me to adjust the plan."
`.trim();
