import * as vscode from 'vscode';
import { Workflow, WorkflowPhase } from '../models/types';

export interface WorkflowMatch {
  workflow: Workflow | null;
  phase: WorkflowPhase;
  command: string | null;
}

export class WorkflowSelector {
  select(request: vscode.ChatRequest, workflows: Workflow[]): WorkflowMatch {
    // 1. Explicit slash commands
    switch (request.command) {
      case 'discover':
        return { workflow: null, phase: 'discovery', command: 'discover' };
      case 'plan':
        return { workflow: null, phase: 'planning', command: 'plan' };
      case 'implement':
        return { workflow: null, phase: 'implementation', command: 'implement' };
      case 'review':
        return { workflow: null, phase: 'review', command: 'review' };
      case 'workflow': {
        const workflowId = request.prompt.trim().split(/\s+/)[0];
        const workflow = workflows.find(
          (w) =>
            w.id === workflowId || w.name.toLowerCase() === workflowId.toLowerCase(),
        );
        return {
          workflow: workflow ?? null,
          phase: workflow?.entryPhase ?? 'discovery',
          command: 'workflow',
        };
      }
    }

    // 2. Fuzzy trigger phrase matching
    const lowerPrompt = request.prompt.toLowerCase();
    for (const wf of workflows) {
      for (const phrase of wf.triggerPhrases ?? []) {
        if (lowerPrompt.includes(phrase.toLowerCase())) {
          return { workflow: wf, phase: wf.entryPhase, command: null };
        }
      }
    }

    // 3. Default: discovery phase with no specific workflow
    return { workflow: null, phase: 'discovery', command: null };
  }
}
