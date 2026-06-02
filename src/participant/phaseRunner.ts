import * as vscode from 'vscode';
import { invokeAgent } from './agentInvoker';

/**
 * Runs a single chat phase: builds history, streams the model response.
 * (Execution tracking / the visualizer were removed — the sidebar "inspector"
 * is now a static asset navigator, not a run graph.)
 */
export class PhaseRunner {
  async run(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    systemPrompt: string,
    phaseHeader: string,
  ): Promise<vscode.ChatResult> {
    const history: vscode.LanguageModelChatMessage[] = [];
    for (const turn of context.history) {
      if (turn instanceof vscode.ChatRequestTurn) {
        history.push(vscode.LanguageModelChatMessage.User(turn.prompt));
      } else if (turn instanceof vscode.ChatResponseTurn) {
        const text = turn.response
          .filter(
            (r): r is vscode.ChatResponseMarkdownPart =>
              r instanceof vscode.ChatResponseMarkdownPart,
          )
          .map((r) => r.value.value)
          .join('');
        if (text) history.push(vscode.LanguageModelChatMessage.Assistant(text));
      }
    }

    stream.markdown(phaseHeader);

    try {
      for await (const chunk of invokeAgent({
        systemPrompt,
        history,
        userPrompt: request.prompt,
        token,
      })) {
        stream.markdown(chunk);
      }
    } catch (err) {
      if (err instanceof vscode.LanguageModelError) {
        stream.markdown(`\n\n**Error** (${err.code}): ${err.message}`);
        return { metadata: { command: request.command } };
      }
      throw err;
    }

    return { metadata: { command: request.command } };
  }
}
