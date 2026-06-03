import * as vscode from 'vscode';
import { Skill, Agent } from '../models/types';
import { AssetLoader } from '../services/assetLoader';
import { recordAsset, recordUsage } from '../analytics/metrics';
import { countTokensSafe } from '../analytics/metricsCollector';

/**
 * Handles explicit skill and agent invocation via /skill and /agent commands.
 *
 * /skill <id> [optional extra context]
 *   → Applies the skill's systemPrompt as a focused context, fills any
 *     {{parameter}} placeholders in userPromptTemplate, sends to the LM.
 *
 * /agent <id> [question]
 *   → Adopts the agent's role + systemPrompt for the entire turn.
 */
export class SkillRunner {
  constructor(private assetLoader: AssetLoader) {}

  // ── /skill handler ──────────────────────────────────────────────────────

  async runSkill(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<vscode.ChatResult> {
    // Parse:  /skill <id> [extra text]
    const [skillId, ...rest] = request.prompt.trim().split(/\s+/);
    const extraContext = rest.join(' ');

    // If no skill id given — list available skills
    if (!skillId) {
      return this._listSkills(stream);
    }

    const asset = this.assetLoader.getById(skillId);
    if (!asset || asset.type !== 'skill') {
      stream.markdown(
        `❌ **Skill not found:** \`${skillId}\`\n\n` +
        `Available skills:\n` +
        this.assetLoader.getAssetsByType('skill')
          .map(s => `- \`${s.id}\` — ${s.description}`)
          .join('\n'),
      );
      return { metadata: { command: 'skill' } };
    }

    const skill = asset as Skill;
    stream.markdown(
      `⚡ **Applying skill:** ${skill.name}\n\n` +
      (skill.description ? `> ${skill.description}\n\n` : ''),
    );

    // Build system prompt: skill's systemPrompt + best practices
    const systemParts: string[] = [skill.systemPrompt];
    if (skill.bestPractices?.length) {
      systemParts.push(
        `Best practices to follow:\n${skill.bestPractices.map(p => `- ${p}`).join('\n')}`,
      );
    }
    const systemPrompt = systemParts.join('\n\n');

    // Build user prompt from template (if available) or raw input
    const userPrompt = skill.userPromptTemplate
      ? this._fillTemplate(skill.userPromptTemplate, extraContext, context)
      : extraContext || request.prompt;

    // Select model
    const model = await this._selectModel();
    if (!model) {
      stream.markdown('❌ No Copilot language model available.');
      return { metadata: { command: 'skill' } };
    }

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(systemPrompt),
      // Include relevant history
      ...this._buildHistory(context),
      vscode.LanguageModelChatMessage.User(userPrompt || 'Please apply this skill.'),
    ];

    recordAsset({ event: 'invoke', assetId: skill.id, assetType: 'skill' });
    const startedAt = Date.now();
    let output = '';
    try {
      const response = await model.sendRequest(messages, {}, token);
      for await (const chunk of response.text) {
        if (token.isCancellationRequested) break;
        output += chunk;
        stream.markdown(chunk);
      }
    } catch (err) {
      if (err instanceof vscode.LanguageModelError) {
        stream.markdown(`\n\n❌ **Error:** ${err.message}`);
      } else throw err;
    }
    void recordRun(model, systemPrompt + userPrompt, output, Date.now() - startedAt, skill.id, 'skill');

    // Offer related skills as follow-ups via skill examples
    if (skill.examples?.length) {
      stream.markdown('\n\n---\n**Example prompts for this skill:**\n');
      for (const ex of skill.examples.slice(0, 2)) {
        stream.markdown(`- *"${ex.input}"*\n`);
      }
    }

    return { metadata: { command: 'skill', skillId } };
  }

  // ── /agent handler ──────────────────────────────────────────────────────

  async runAgent(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<vscode.ChatResult> {
    const [agentId, ...rest] = request.prompt.trim().split(/\s+/);
    const question = rest.join(' ');

    if (!agentId) {
      return this._listAgents(stream);
    }

    const asset = this.assetLoader.getById(agentId);
    if (!asset || asset.type !== 'agent') {
      stream.markdown(
        `❌ **Agent not found:** \`${agentId}\`\n\n` +
        `Available agents:\n` +
        this.assetLoader.getAssetsByType('agent')
          .map(a => `- \`${a.id}\` — ${a.description}`)
          .join('\n'),
      );
      return { metadata: { command: 'agent' } };
    }

    const agent = asset as Agent;
    stream.markdown(
      `🤖 **Agent:** ${agent.name}\n` +
      `**Role:** ${agent.role}\n\n`,
    );

    // Build system prompt from agent definition
    const systemParts = [agent.systemPrompt];

    // Also inject skills the agent has declared
    const agentSkills = (agent.capabilities ?? [])
      .flatMap(cap => cap.skillIds ?? [])
      .map(sid => this.assetLoader.getById(sid))
      .filter((s): s is Skill => s?.type === 'skill');

    if (agentSkills.length > 0) {
      systemParts.push(
        `Skills available to you:\n` +
        agentSkills.map(s => `## ${s.name}\n${s.systemPrompt}`).join('\n\n'),
      );
    }

    const systemPrompt = systemParts.join('\n\n---\n\n');

    const model = await this._selectModel();
    if (!model) {
      stream.markdown('❌ No Copilot language model available.');
      return { metadata: { command: 'agent' } };
    }

    const userPrompt = question || 'What can you help me with as this agent?';
    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(systemPrompt),
      ...this._buildHistory(context),
      vscode.LanguageModelChatMessage.User(userPrompt),
    ];

    recordAsset({ event: 'invoke', assetId: agent.id, assetType: 'agent' });
    const startedAt = Date.now();
    let output = '';
    try {
      const response = await model.sendRequest(messages, {}, token);
      for await (const chunk of response.text) {
        if (token.isCancellationRequested) break;
        output += chunk;
        stream.markdown(chunk);
      }
    } catch (err) {
      if (err instanceof vscode.LanguageModelError) {
        stream.markdown(`\n\n❌ **Error:** ${err.message}`);
      } else throw err;
    }
    void recordRun(model, systemPrompt + userPrompt, output, Date.now() - startedAt, agent.id, 'agent');

    return { metadata: { command: 'agent', agentId } };
  }

  // ── Template substitution ───────────────────────────────────────────────

  private _fillTemplate(
    template: string,
    userText: string,
    context: vscode.ChatContext,
  ): string {
    // Grab the most recent code block from history if present
    const historyCode = this._extractLastCodeBlock(context);

    return template
      .replace(/\{\{code\}\}/g, historyCode || userText || '[paste your code here]')
      .replace(/\{\{language\}\}/g, this._detectLanguage(historyCode || userText))
      .replace(/\{\{focusAreas\}\}/g, 'all')
      .replace(/\{\{framework\}\}/g, 'auto-detect')
      .replace(/\{\{coverage\}\}/g, 'comprehensive')
      // Any remaining {{placeholder}} → replace with userText or empty string
      .replace(/\{\{[^}]+\}\}/g, userText || '');
  }

  private _extractLastCodeBlock(context: vscode.ChatContext): string {
    for (let i = context.history.length - 1; i >= 0; i--) {
      const turn = context.history[i];
      if (turn instanceof vscode.ChatRequestTurn) {
        const match = turn.prompt.match(/```[\w]*\n([\s\S]+?)```/);
        if (match) return match[1].trim();
      }
    }
    return '';
  }

  private _detectLanguage(code: string): string {
    if (!code) return 'code';
    if (code.includes('interface ') || code.includes(': string') || code.includes('readonly '))
      return 'typescript';
    if (code.includes('def ') && code.includes(':')) return 'python';
    if (code.includes('func ') && code.includes('go')) return 'go';
    if (code.includes('public class ') || code.includes('void ')) return 'java';
    return 'javascript';
  }

  private _buildHistory(context: vscode.ChatContext): vscode.LanguageModelChatMessage[] {
    return context.history.flatMap(turn => {
      if (turn instanceof vscode.ChatRequestTurn) {
        return [vscode.LanguageModelChatMessage.User(turn.prompt)];
      }
      if (turn instanceof vscode.ChatResponseTurn) {
        const text = turn.response
          .filter((r): r is vscode.ChatResponseMarkdownPart =>
            r instanceof vscode.ChatResponseMarkdownPart)
          .map(r => r.value.value)
          .join('');
        return text ? [vscode.LanguageModelChatMessage.Assistant(text)] : [];
      }
      return [];
    });
  }

  // ── Model selection ─────────────────────────────────────────────────────

  private async _selectModel(): Promise<vscode.LanguageModelChat | undefined> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
      if (models.length > 0) return models[0];
    } catch { /* fall through */ }
    try {
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      if (models.length > 0) return models[0];
    } catch { /* fall through */ }
    return undefined;
  }

  // ── List helpers ────────────────────────────────────────────────────────

  private _listSkills(stream: vscode.ChatResponseStream): vscode.ChatResult {
    const skills = this.assetLoader.getAssetsByType('skill') as Skill[];
    stream.markdown(`## Available Skills\n\nUsage: \`@agent-studio /skill <id> [your code or question]\`\n\n`);
    for (const s of skills) {
      const badge = s.enabled === 'enabled' ? '🟢' : '⚪';
      stream.markdown(
        `${badge} **\`${s.id}\`** — ${s.name}\n` +
        `> ${s.description}\n\n`,
      );
    }
    stream.markdown(
      `\n💡 **Tip:** Enable a skill in the Inspector sidebar to auto-inject it into ` +
      `every request, or invoke it explicitly with \`/skill <id>\`.`,
    );
    return { metadata: { command: 'skill' } };
  }

  private _listAgents(stream: vscode.ChatResponseStream): vscode.ChatResult {
    const agents = this.assetLoader.getAssetsByType('agent') as Agent[];
    stream.markdown(`## Available Agents\n\nUsage: \`@agent-studio /agent <id> [question]\`\n\n`);
    for (const a of agents) {
      const badge = a.enabled === 'enabled' ? '🟢' : '⚪';
      stream.markdown(
        `${badge} **\`${a.id}\`** — ${a.name}\n` +
        `> **Role:** ${a.role}\n` +
        `> ${a.description}\n\n`,
      );
    }
    return { metadata: { command: 'agent' } };
  }
}

/** Record an anonymous token-usage metric for a skill/agent run (numbers only). */
async function recordRun(
  model: vscode.LanguageModelChat,
  inputText: string,
  output: string,
  durationMs: number,
  assetId: string,
  command: 'skill' | 'agent',
): Promise<void> {
  const [inputTokens, outputTokens] = await Promise.all([
    countTokensSafe(model, inputText),
    countTokensSafe(model, output),
  ]);
  recordUsage({
    model: model.family || model.id || 'copilot',
    assetId,
    assetType: command,
    command,
    inputTokens,
    outputTokens,
    durationMs,
  });
}
