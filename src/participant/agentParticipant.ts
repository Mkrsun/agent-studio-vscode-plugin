import * as vscode from 'vscode';
import { AssetLoader } from '../services/assetLoader';
import { ScopeService } from '../services/scopeService';
import { ConfigService } from '../services/configService';
import { AuthService } from '../auth/authService';
import { WorkflowSelector } from './workflowSelector';
import { ContextInjector } from './contextInjector';
import { PhaseRunner } from './phaseRunner';
import { SkillRunner } from './skillRunner';
import { PARTICIPANT_ID } from '../constants';

/**
 * Registers the `@agent-studio` chat participant. The request handler and the
 * follow-up provider are real methods/functions (not closures nested in the
 * register call), so each piece reads on its own.
 */
export function registerParticipant(
  context: vscode.ExtensionContext,
  assetLoader: AssetLoader,
  scopeService: ScopeService,
  configService: ConfigService,
  authService: AuthService | null,
): vscode.Disposable {
  return new AgentParticipant(assetLoader, scopeService, configService, authService).register(context);
}

class AgentParticipant {
  private readonly selector = new WorkflowSelector();
  private readonly injector = new ContextInjector();
  private readonly runner = new PhaseRunner();
  private readonly skillRunner: SkillRunner;

  constructor(
    private readonly assetLoader: AssetLoader,
    private readonly scopeService: ScopeService,
    private readonly configService: ConfigService,
    private readonly authService: AuthService | null,
  ) {
    this.skillRunner = new SkillRunner(assetLoader);
  }

  register(context: vscode.ExtensionContext): vscode.Disposable {
    const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, this.handleRequest);
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icons', 'agent-studio.svg');
    participant.followupProvider = { provideFollowups: (result) => buildFollowups(result) };
    return participant;
  }

  // Arrow field so `this` is bound when VS Code invokes it as a callback.
  private handleRequest = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<vscode.ChatResult> => {
    if (this.isSignedOut()) {
      stream.markdown(
        '**You have been signed out of Agent Studio.** Run `Agent Studio: Sign In with GitHub` from the Command Palette to continue.',
      );
      return { errorDetails: { message: 'Not authenticated.' } };
    }

    if (request.command === 'skill') return this.skillRunner.runSkill(request, chatContext, stream, token);
    if (request.command === 'agent') return this.skillRunner.runAgent(request, chatContext, stream, token);

    return this.runWorkflowPhase(request, chatContext, stream, token);
  };

  /** Secondary auth defense; the primary one is deferred surface registration. */
  private isSignedOut(): boolean {
    return this.authService !== null && !this.authService.isAuthenticated();
  }

  private runWorkflowPhase(
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<vscode.ChatResult> {
    const activeAssets = this.assetLoader.getAll().filter((a) => this.scopeService.isActive(a.id));
    const match = this.selector.select(request, this.assetLoader.getEnabledWorkflows());

    const inject = this.configService.autoInjectEnabled();
    const systemPrompt = this.injector.buildSystemPrompt(
      match.phase,
      match.workflow,
      inject ? activeAssets : [],
      inject ? this.configService.getMaxContextAssets() : 0,
    );
    const phaseHeader = this.injector.buildPhaseHeader(match.phase, match.workflow?.name);

    return this.runner.run(request, chatContext, stream, token, systemPrompt, phaseHeader);
  }
}

/** Suggested next prompts, keyed by the command that produced `result`. */
function buildFollowups(result: vscode.ChatResult): vscode.ChatFollowup[] {
  const command = result.metadata?.['command'] as string | undefined;

  switch (command) {
    case 'skill':
      return followupsAfterSkill(result.metadata?.['skillId'] as string | undefined);
    case 'agent':
      return [
        { prompt: '/discover', label: '$(search) Start Discovery phase' },
        { prompt: '/workflow full-feature-workflow', label: '$(git-branch) Run full feature workflow' },
      ];
    case 'discover':
      return [{ prompt: '/plan', label: '$(arrow-right) Move to Planning' }];
    case 'plan':
      return [
        { prompt: '/implement', label: '$(arrow-right) Start Implementation' },
        { prompt: '/discover', label: '$(arrow-left) Back to Discovery' },
      ];
    case 'implement':
      return [
        { prompt: '/review', label: '$(check) Run Final Review' },
        { prompt: '/skill test-generator', label: '$(beaker) Generate tests' },
      ];
    default:
      return [
        { prompt: '/skill', label: '$(tools) Browse skills' },
        { prompt: '/agent', label: '$(robot) Browse agents' },
        { prompt: '/workflow full-feature-workflow', label: '$(git-branch) Full Feature Workflow' },
        { prompt: '/workflow bug-fix-workflow', label: '$(bug) Bug Fix Workflow' },
      ];
  }
}

function followupsAfterSkill(skillId: string | undefined): vscode.ChatFollowup[] {
  if (skillId === 'code-review') {
    return [
      { prompt: '/skill refactor-assistant', label: '$(tools) Refactor this code' },
      { prompt: '/skill test-generator', label: '$(beaker) Generate tests' },
    ];
  }
  return [{ prompt: '/skill code-review', label: '$(eye) Review the result' }];
}
