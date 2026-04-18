import * as vscode from 'vscode';
import {
  Workflow,
  WorkflowExecution,
  StepExecution,
  StepStatus,
  WorkflowPhase,
  AgentMessage,
  ToolInvocation,
  InspectorEvent,
  PlaygroundInvocation,
} from '../models/types';

const MAX_EXECUTIONS = 50;

function uuid(): string {
  return crypto.randomUUID();
}

export class ExecutionTracker {
  private _executions = new Map<string, WorkflowExecution>();
  private _latestId: string | undefined;
  private _onUpdate = new vscode.EventEmitter<WorkflowExecution>();
  private _onEvent  = new vscode.EventEmitter<{ event: InspectorEvent; entity?: AgentMessage | ToolInvocation }>();

  readonly onExecutionUpdate = this._onUpdate.event;
  readonly onEvent = this._onEvent.event;

  startWorkflow(workflow: Workflow): WorkflowExecution {
    const steps: StepExecution[] = workflow.steps.map((s) => ({
      stepId: s.id,
      stepName: s.name,
      phase: s.phase,
      status: 'pending',
      agentId: s.agentId,
    }));

    const execution: WorkflowExecution = {
      id: uuid(),
      workflowId: workflow.id,
      workflowName: workflow.name,
      startedAt: Date.now(),
      currentPhase: workflow.entryPhase,
      steps,
      status: 'running',
    };

    this._store(execution);
    this._fireSnapshot(execution);
    return execution;
  }

  updateStep(executionId: string, stepId: string, status: StepStatus, error?: string): void {
    const exec = this._executions.get(executionId);
    if (!exec) return;

    const step = exec.steps.find((s) => s.stepId === stepId);
    if (!step) return;

    step.status = status;
    if (status === 'running') {
      step.startedAt = Date.now();
      exec.currentStepId = stepId;
      // Derive the current phase from the running step
      exec.currentPhase = step.phase;
    }
    if (status === 'done' || status === 'error' || status === 'skipped') {
      step.completedAt = Date.now();
    }
    if (error) step.errorMessage = error;

    this._fireSnapshot(exec);
  }

  advanceToPhase(executionId: string, phase: WorkflowPhase): void {
    const exec = this._executions.get(executionId);
    if (!exec) return;
    exec.currentPhase = phase;
    // Mark steps in prior phases that are still pending as skipped
    for (const step of exec.steps) {
      if (step.phase !== phase && step.status === 'pending') {
        step.status = 'skipped';
      }
    }
    this._fireSnapshot(exec);
  }

  completeWorkflow(executionId: string): void {
    const exec = this._executions.get(executionId);
    if (!exec) return;
    exec.status = 'completed';
    exec.completedAt = Date.now();
    // Finalize any steps still in-flight
    for (const step of exec.steps) {
      if (step.status === 'pending' || step.status === 'running') {
        step.status = 'done';
        step.completedAt = Date.now();
      }
    }
    this._fireSnapshot(exec);
  }

  failWorkflow(executionId: string, error: string): void {
    const exec = this._executions.get(executionId);
    if (!exec) return;
    exec.status = 'failed';
    exec.completedAt = Date.now();
    const running = exec.steps.find((s) => s.status === 'running');
    if (running) {
      running.status = 'error';
      running.errorMessage = error;
      running.completedAt = Date.now();
    }
    this._fireSnapshot(exec);
  }

  getLatest(): WorkflowExecution | undefined {
    return this._latestId ? this._executions.get(this._latestId) : undefined;
  }

  getAll(): WorkflowExecution[] {
    return Array.from(this._executions.values());
  }

  startPlayground(opts: {
    name: string;
    input: string;
    frameworkPluginName?: string;
  }): PlaygroundInvocation {
    const exec: PlaygroundInvocation = {
      id: uuid(),
      workflowId: 'playground',
      workflowName: opts.name,
      startedAt: Date.now(),
      currentPhase: 'custom',
      steps: [],
      status: 'running',
      messages: [],
      tools: [],
      events: [],
      playgroundInput: opts.input,
      frameworkPluginName: opts.frameworkPluginName,
    };
    this._store(exec);
    this._recordAndFireEvent(exec.id, { type: 'workflow:started' });
    this._fireSnapshot(exec);
    return exec;
  }

  setPlaygroundOutput(executionId: string, text: string): void {
    const exec = this._executions.get(executionId);
    if (exec) exec.playgroundOutput = text;
  }

  recordAgentMessage(
    executionId: string,
    msg: Omit<AgentMessage, 'id' | 'executionId' | 'timestamp'>,
  ): AgentMessage {
    const exec = this._executions.get(executionId);
    if (!exec) throw new Error(`No execution: ${executionId}`);
    const full: AgentMessage = { id: uuid(), executionId, timestamp: Date.now(), ...msg };
    if (!exec.messages) exec.messages = [];
    exec.messages.push(full);
    this._recordAndFireEvent(executionId, {
      type: 'agent:message',
      stepId: msg.stepId,
      agentId: msg.agentId,
      payload: { kind: 'message', messageId: full.id },
    }, full);
    return full;
  }

  beginToolInvocation(
    executionId: string,
    inv: Omit<ToolInvocation, 'id' | 'executionId' | 'startedAt' | 'completedAt'>,
  ): string {
    const exec = this._executions.get(executionId);
    if (!exec) throw new Error(`No execution: ${executionId}`);
    const full: ToolInvocation = { id: uuid(), executionId, startedAt: Date.now(), ...inv };
    if (!exec.tools) exec.tools = [];
    exec.tools.push(full);
    this._recordAndFireEvent(executionId, {
      type: 'tool:invoked',
      stepId: inv.stepId,
      agentId: inv.agentId,
      payload: { kind: 'tool', toolId: full.id },
    }, full);
    return full.id;
  }

  /** Complete (or fail) a previously-begun tool invocation. */
  completeToolInvocation(
    executionId: string,
    toolId: string,
    patch: { result?: unknown; error?: string },
  ): void {
    const exec = this._executions.get(executionId);
    if (!exec) return;
    const tool = exec.tools?.find((t) => t.id === toolId);
    if (!tool) return;
    tool.completedAt = Date.now();
    if (patch.result !== undefined) tool.result = patch.result;
    if (patch.error) tool.error = patch.error;
    this._recordAndFireEvent(executionId, {
      type: 'tool:completed',
      stepId: tool.stepId,
      agentId: tool.agentId,
      payload: { kind: 'tool', toolId },
    }, tool);
  }

  recordEvent(
    executionId: string,
    ev: Omit<InspectorEvent, 'id' | 'executionId' | 'timestamp'>,
  ): InspectorEvent {
    return this._recordAndFireEvent(executionId, ev);
  }

  dispose(): void {
    this._onUpdate.dispose();
    this._onEvent.dispose();
  }

  private _store(exec: WorkflowExecution): void {
    if (this._executions.size >= MAX_EXECUTIONS) {
      const oldest = this._executions.keys().next().value;
      if (oldest) this._executions.delete(oldest);
    }
    this._executions.set(exec.id, exec);
    this._latestId = exec.id;
  }

  private _fireSnapshot(exec: WorkflowExecution): void {
    this._onUpdate.fire({ ...exec, steps: exec.steps.map((s) => ({ ...s })) });
  }

  private _recordAndFireEvent(
    executionId: string,
    ev: Omit<InspectorEvent, 'id' | 'executionId' | 'timestamp'>,
    entity?: AgentMessage | ToolInvocation,
  ): InspectorEvent {
    const exec = this._executions.get(executionId);
    const full: InspectorEvent = {
      id: uuid(),
      executionId,
      timestamp: Date.now(),
      ...ev,
    };
    if (exec) {
      if (!exec.events) exec.events = [];
      exec.events.push(full);
    }
    this._onEvent.fire({ event: full, entity });
    return full;
  }
}
