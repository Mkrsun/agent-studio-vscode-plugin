import * as vscode from 'vscode';
import { Workflow, WorkflowPhase } from '../models/types';
import { ExecutionTracker } from '../visualizer/executionTracker';
import { invokeAgent, selectModel } from './agentInvoker';
import { COMMANDS } from '../constants';

export class PhaseRunner {
  async run(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    systemPrompt: string,
    phaseHeader: string,
    workflow: Workflow | null,
    phase: WorkflowPhase,
    tracker: ExecutionTracker,
  ): Promise<vscode.ChatResult> {
    let executionId: string | null = null;
    let currentStepId: string | null = null;
    let currentAgentId: string | undefined;

    if (workflow) {
      const execution = tracker.startWorkflow(workflow);
      executionId = execution.id;
      const firstStep = workflow.steps.find((s) => s.phase === phase);
      if (firstStep) {
        tracker.updateStep(executionId, firstStep.id, 'running');
        currentStepId = firstStep.id;
        currentAgentId = firstStep.agentId;
      }
    }

    if (executionId) {
      tracker.recordAgentMessage(executionId, {
        role: 'system',
        direction: 'outbound',
        text: systemPrompt,
        stepId: currentStepId ?? undefined,
        agentId: currentAgentId,
      });
    }

    if (executionId && workflow && currentStepId) {
      const step = workflow.steps.find((s) => s.id === currentStepId);
      if (step) {
        for (const skillId of step.skillIds ?? []) {
          const toolId = tracker.beginToolInvocation(executionId, {
            kind: 'skill-injection',
            name: skillId,
            stepId: currentStepId,
            agentId: currentAgentId,
            args: { skillId },
          });
          // Skills are injected synchronously into the system prompt — complete immediately
          tracker.completeToolInvocation(executionId, toolId, {
            result: { injectedIntoSystemPrompt: true },
          });
        }
        for (const instrId of step.instructionIds ?? []) {
          const toolId = tracker.beginToolInvocation(executionId, {
            kind: 'instruction-injection',
            name: instrId,
            stepId: currentStepId,
            agentId: currentAgentId,
            args: { instructionId: instrId },
          });
          tracker.completeToolInvocation(executionId, toolId, {
            result: { injectedIntoSystemPrompt: true },
          });
        }
      }
    }

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

    let assistantText = '';
    try {
      for await (const chunk of invokeAgent({
        systemPrompt,
        history,
        userPrompt: request.prompt,
        token,
        onOutboundMessage: (role, text) => {
          if (!executionId) return;
          tracker.recordAgentMessage(executionId, {
            role,
            direction: 'outbound',
            text,
            stepId: currentStepId ?? undefined,
            agentId: currentAgentId,
          });
        },
      })) {
        stream.markdown(chunk);
        assistantText += chunk;
      }
    } catch (err) {
      if (err instanceof vscode.LanguageModelError) {
        stream.markdown(`\n\n**Error** (${err.code}): ${err.message}`);
        if (executionId) tracker.failWorkflow(executionId, err.message);
        return { metadata: { command: request.command } };
      }
      throw err;
    }

    if (executionId && assistantText) {
      tracker.recordAgentMessage(executionId, {
        role: 'assistant',
        direction: 'inbound',
        text: assistantText,
        stepId: currentStepId ?? undefined,
        agentId: currentAgentId,
      });
    }

    if (executionId && workflow) {
      const phaseSteps = workflow.steps.filter((s) => s.phase === phase);
      for (const step of phaseSteps) {
        tracker.updateStep(executionId, step.id, 'done');
      }
      const lastPhase = workflow.phases[workflow.phases.length - 1];
      if (phase === lastPhase) {
        tracker.completeWorkflow(executionId);
      }
    }

    stream.button({
      command: COMMANDS.OPEN_VISUALIZER,
      title: '$(type-hierarchy) View Execution Flow',
    });

    return { metadata: { command: request.command } };
  }
}
