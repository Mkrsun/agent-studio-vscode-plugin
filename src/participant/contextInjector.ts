import { Asset, Instruction, Skill, Workflow, WorkflowPhase } from '../models/types';
import { DISCOVERY_PROMPT } from './prompts/discovery';
import { PLANNING_PROMPT } from './prompts/planning';
import { IMPLEMENTATION_PROMPT } from './prompts/implementation';

const PHASE_PROMPTS: Record<WorkflowPhase, string> = {
  discovery: DISCOVERY_PROMPT,
  planning: PLANNING_PROMPT,
  implementation: IMPLEMENTATION_PROMPT,
  review: `
In the REVIEW phase, critically evaluate the implementation against requirements.

Check for:
- All acceptance criteria from discovery are satisfied
- Code follows project conventions and best practices
- Test coverage is adequate (happy path + edge cases + errors)
- No security vulnerabilities, no swallowed errors, no leaked secrets
- Performance is acceptable for the use case

Output format:
**Review Summary**
✅ Passing / ⚠️ Needs attention / ❌ Failing

List each issue with: severity, location, and a concrete suggested fix.
`.trim(),
  custom: 'Follow the custom workflow step instructions provided.',
};

export class ContextInjector {
  buildSystemPrompt(
    phase: WorkflowPhase,
    workflow: Workflow | null,
    assets: Asset[],
    maxAssets: number,
  ): string {
    const parts: string[] = [];

    // Core identity
    parts.push(
      `You are Agent Studio, an AI development assistant embedded in VS Code via GitHub Copilot.\n` +
      `You guide developers through structured workflows: discovery → planning → implementation → review.\n` +
      `Current phase: **${phase.toUpperCase()}**.\n` +
      `Be concise, precise, and always follow the conventions of the existing codebase.`,
    );

    // Phase-specific instructions
    parts.push(`## Phase Instructions\n\n${PHASE_PROMPTS[phase]}`);

    // Inject enabled instructions (sorted by priority desc, capped at maxAssets)
    const instructions = (
      assets.filter((a): a is Instruction => a.type === 'instruction' && a.enabled === 'enabled')
        .sort((a, b) => b.priority - a.priority)
        .slice(0, maxAssets)
    );

    for (const inst of instructions) {
      parts.push(`## Instruction: ${inst.name}\n\n${inst.content}`);
    }

    // Inject workflow context if one is active
    if (workflow) {
      const phaseSteps = workflow.steps.filter((s) => s.phase === phase);
      parts.push(`## Active Workflow: ${workflow.name}`);
      if (phaseSteps.length > 0) {
        const stepList = phaseSteps
          .map((s) => `- **${s.name}**${s.agentId ? ` [${s.agentId}]` : ''}: ${s.prompt.split('\n')[0]}`)
          .join('\n');
        parts.push(`Steps in this phase:\n${stepList}`);
      }
    }

    // Inject enabled skills for this phase
    const skills = assets
      .filter((a): a is Skill => a.type === 'skill' && a.enabled === 'enabled')
      .slice(0, Math.max(1, maxAssets - instructions.length));

    for (const skill of skills) {
      parts.push(`## Available Skill: ${skill.name}\n\n${skill.systemPrompt}`);
    }

    return parts.join('\n\n---\n\n');
  }

  buildPhaseHeader(phase: WorkflowPhase, workflowName?: string): string {
    const phaseEmoji: Record<WorkflowPhase, string> = {
      discovery: '🔍',
      planning: '📐',
      implementation: '⚙️',
      review: '🔎',
      custom: '⚡',
    };
    const emoji = phaseEmoji[phase] ?? '▶';
    const wfPart = workflowName ? ` · *${workflowName}*` : '';
    return `${emoji} **${phase.charAt(0).toUpperCase() + phase.slice(1)} Phase**${wfPart}\n\n`;
  }
}
