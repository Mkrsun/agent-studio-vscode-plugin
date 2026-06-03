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

export function registerParticipant(
  context: vscode.ExtensionContext,
  assetLoader: AssetLoader,
  scopeService: ScopeService,
  configService: ConfigService,
  authService: AuthService | null,
): vscode.Disposable {
  const selector = new WorkflowSelector();
  const injector = new ContextInjector();
  const runner = new PhaseRunner();
  const skillRunner = new SkillRunner(assetLoader);

  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    async (
      request: vscode.ChatRequest,
      chatContext: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken,
    ): Promise<vscode.ChatResult> => {

      // ── Auth guard (secondary defense; primary is deferred registration) ──
      if (authService && !authService.isAuthenticated()) {
        stream.markdown(
          '**You have been signed out of Agent Studio.** Run `Agent Studio: Sign In with GitHub` from the Command Palette to continue.',
        );
        return { errorDetails: { message: 'Not authenticated.' } };
      }

      // ── /skill <id> — explicit skill invocation ──────────────────────
      if (request.command === 'skill') {
        return skillRunner.runSkill(request, chatContext, stream, token);
      }

      // ── /agent <id> — adopt an agent persona ─────────────────────────
      if (request.command === 'agent') {
        return skillRunner.runAgent(request, chatContext, stream, token);
      }

      // ── Workflow / phase routing ──────────────────────────────────────
      // Only inject assets that are session- or repo-scoped (active)
      const allAssets = assetLoader.getAll().filter(a => scopeService.isActive(a.id));
      const workflows = assetLoader.getEnabledWorkflows();
      const match = selector.select(request, workflows);

      const maxAssets = configService.getMaxContextAssets();
      const systemPrompt = configService.autoInjectEnabled()
        ? injector.buildSystemPrompt(match.phase, match.workflow, allAssets, maxAssets)
        : injector.buildSystemPrompt(match.phase, match.workflow, [], 0);

      const phaseHeader = injector.buildPhaseHeader(match.phase, match.workflow?.name);

      return runner.run(
        request,
        chatContext,
        stream,
        token,
        systemPrompt,
        phaseHeader,
      );
    },
  );

  participant.iconPath = vscode.Uri.joinPath(
    context.extensionUri,
    'media',
    'icons',
    'agent-studio.svg',
  );

  // ── Follow-ups ──────────────────────────────────────────────────────────
  participant.followupProvider = {
    provideFollowups(
      result: vscode.ChatResult,
      _context: vscode.ChatContext,
      _token: vscode.CancellationToken,
    ): vscode.ChatFollowup[] {
      const command = result.metadata?.['command'] as string | undefined;
      const followups: vscode.ChatFollowup[] = [];

      switch (command) {
        case 'skill': {
          // After a skill run, offer to apply another or move to review
          const skillId = result.metadata?.['skillId'] as string | undefined;
          if (skillId === 'code-review') {
            followups.push({ prompt: '/skill refactor-assistant', label: '$(tools) Refactor this code' });
            followups.push({ prompt: '/skill test-generator', label: '$(beaker) Generate tests' });
          } else {
            followups.push({ prompt: '/skill code-review', label: '$(eye) Review the result' });
          }
          break;
        }
        case 'agent':
          followups.push({ prompt: '/discover', label: '$(search) Start Discovery phase' });
          followups.push({ prompt: '/workflow full-feature-workflow', label: '$(git-branch) Run full feature workflow' });
          break;
        case 'discover':
          followups.push({ prompt: '/plan', label: '$(arrow-right) Move to Planning' });
          break;
        case 'plan':
          followups.push({ prompt: '/implement', label: '$(arrow-right) Start Implementation' });
          followups.push({ prompt: '/discover', label: '$(arrow-left) Back to Discovery' });
          break;
        case 'implement':
          followups.push({ prompt: '/review', label: '$(check) Run Final Review' });
          followups.push({ prompt: '/skill test-generator', label: '$(beaker) Generate tests' });
          break;
        default:
          followups.push({ prompt: '/skill', label: '$(tools) Browse skills' });
          followups.push({ prompt: '/agent', label: '$(robot) Browse agents' });
          followups.push({ prompt: '/workflow full-feature-workflow', label: '$(git-branch) Full Feature Workflow' });
          followups.push({ prompt: '/workflow bug-fix-workflow', label: '$(bug) Bug Fix Workflow' });
      }

      return followups;
    },
  };

  return participant;
}
