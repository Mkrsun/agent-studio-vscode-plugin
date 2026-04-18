import { WorkflowExecution, StepExecution, StepStatus, WorkflowPhase } from '../models/types';

const STATUS_ICONS: Record<StepStatus, string> = {
  pending: '⏳',
  running: '▶',
  done: '✓',
  error: '✗',
  skipped: '—',
};

const PHASE_LABELS: Record<WorkflowPhase, string> = {
  discovery: 'Discovery Phase',
  planning: 'Planning Phase',
  implementation: 'Implementation Phase',
  review: 'Review Phase',
  custom: 'Custom Phase',
};

export class DiagramBuilder {
  buildFlowchart(execution: WorkflowExecution): string {
    const lines: string[] = ['flowchart TD'];

    // Style classes
    lines.push('    classDef pending   fill:#3a3a3a,stroke:#666,color:#999');
    lines.push('    classDef running   fill:#0d4a2a,stroke:#2ea043,color:#fff,stroke-width:3px');
    lines.push('    classDef done      fill:#0d3060,stroke:#58a6ff,color:#fff');
    lines.push('    classDef error     fill:#4a0d0d,stroke:#f85149,color:#fff');
    lines.push('    classDef skipped   fill:#2a2a2a,stroke:#444,color:#555');
    lines.push('');

    // Group steps by phase (preserve order)
    const phaseOrder: WorkflowPhase[] = [];
    const phaseGroups = new Map<WorkflowPhase, StepExecution[]>();

    for (const step of execution.steps) {
      if (!phaseGroups.has(step.phase)) {
        phaseGroups.set(step.phase, []);
        phaseOrder.push(step.phase);
      }
      phaseGroups.get(step.phase)!.push(step);
    }

    // Render subgraphs per phase
    for (const phase of phaseOrder) {
      const steps = phaseGroups.get(phase)!;
      const isCurrentPhase = phase === execution.currentPhase;
      const phaseLabel = isCurrentPhase
        ? `${PHASE_LABELS[phase]} ◀ ACTIVE`
        : PHASE_LABELS[phase];

      lines.push(`    subgraph ${this._sanitizeId(phase)}["${phaseLabel}"]`);
      for (const step of steps) {
        const nodeId = this._sanitizeId(step.stepId);
        const icon = STATUS_ICONS[step.status];
        const agentLabel = step.agentId ? `\\n[${step.agentId}]` : '';
        const timing = this._formatTiming(step);
        const label = `${icon} ${step.stepName}${agentLabel}${timing}`;
        lines.push(`        ${nodeId}["${label}"]`);
      }
      lines.push('    end');
      lines.push('');
    }

    // Apply status classes
    for (const step of execution.steps) {
      lines.push(`    class ${this._sanitizeId(step.stepId)} ${step.status}`);
    }
    lines.push('');

    // Sequential edges between all steps
    const allSteps = execution.steps;
    for (let i = 0; i < allSteps.length - 1; i++) {
      const from = this._sanitizeId(allSteps[i].stepId);
      const to = this._sanitizeId(allSteps[i + 1].stepId);
      lines.push(`    ${from} --> ${to}`);
    }

    return lines.join('\n');
  }

  buildSummaryText(execution: WorkflowExecution): string {
    const done = execution.steps.filter((s) => s.status === 'done').length;
    const total = execution.steps.length;
    const elapsed = execution.completedAt
      ? this._msToHuman(execution.completedAt - execution.startedAt)
      : this._msToHuman(Date.now() - execution.startedAt);

    return (
      `**${execution.workflowName}**  ·  ` +
      `${done}/${total} steps  ·  ` +
      `${execution.status}  ·  ${elapsed}`
    );
  }

  private _sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  private _formatTiming(step: StepExecution): string {
    if (!step.startedAt) return '';
    const end = step.completedAt ?? Date.now();
    const ms = end - step.startedAt;
    return `\\n${this._msToHuman(ms)}`;
  }

  private _msToHuman(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  }
}
