import * as vscode from 'vscode';

export interface InvokeOpts {
  /** System prompt (injected as first User message per VS Code LM API convention). */
  systemPrompt: string;
  /** Prior conversation turns (already built by the caller). */
  history?: vscode.LanguageModelChatMessage[];
  /** The user's current message. */
  userPrompt: string;
  /** Cancellation signal. */
  token: vscode.CancellationToken;
  /** Preferred model family (default: 'gpt-4o'). */
  modelFamily?: string;
  /**
   * Optional callback fired with each outbound message before the request is sent.
   * Allows callers to record system + user messages for the Events/I&O tabs.
   */
  onOutboundMessage?: (role: 'system' | 'user', text: string) => void;
}

export async function selectModel(
  family = 'gpt-4o',
): Promise<vscode.LanguageModelChat | null> {
  let models: vscode.LanguageModelChat[] = [];
  try {
    models = await vscode.lm.selectChatModels({ vendor: 'copilot', family });
  } catch { /* swallow */ }

  if (!models || models.length === 0) {
    try {
      models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    } catch { /* swallow */ }
  }

  return models?.[0] ?? null;
}

/** @throws {vscode.LanguageModelError} if the model returns an error. */
export async function* invokeAgent(opts: InvokeOpts): AsyncGenerator<string> {
  const { systemPrompt, history = [], userPrompt, token, modelFamily, onOutboundMessage } = opts;

  const model = await selectModel(modelFamily);
  if (!model) {
    yield '**Agent Studio**: No GitHub Copilot language model is available. ' +
          'Please ensure GitHub Copilot is installed and you are signed in.';
    return;
  }

  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(systemPrompt),
  ];
  onOutboundMessage?.('system', systemPrompt);

  for (const turn of history) {
    messages.push(turn);
  }

  messages.push(vscode.LanguageModelChatMessage.User(userPrompt));
  onOutboundMessage?.('user', userPrompt);

  const response = await model.sendRequest(messages, {}, token);
  for await (const chunk of response.text) {
    if (token.isCancellationRequested) break;
    yield chunk;
  }
}
