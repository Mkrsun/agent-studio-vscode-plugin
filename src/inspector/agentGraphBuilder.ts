import {
  WorkflowExecution,
  StepExecution,
} from '../models/types';
import { InstalledPluginRecord } from '../marketplace/pluginTypes';
import { Workflow } from '../models/types';

export interface AgentNode {
  id: string;
  label: string;
  agentId: string;
  stepCount: number;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'planned';
  phase?: string;
}

export interface AgentEdge {
  from: string;
  to: string;
  key: string;
}

export interface AgentGraph {
  nodes: AgentNode[];
  edges: AgentEdge[];
  /** Map from edgeKey to a CSS selector hint (for animation post-render). */
  edgeIndex: Record<string, string>;
  /** Node id of the currently-running agent (if any). */
  activeAgentId?: string;
}

export function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

function edgeKey(fromId: string, toId: string): string {
  return `${fromId}_${toId}`;
}

export class AgentGraphBuilder {

  buildFromExecution(execution: WorkflowExecution): AgentGraph {
    const graph = this._collapseSteps(
      execution.steps,
      (s) => s.agentId ?? `step_${s.stepId}`,
      (s) => stepStatusToNodeStatus(s.status),
      (s) => s.agentId ?? s.stepName,
      (s) => s.phase,
    );

    if (execution.currentStepId) {
      const running = execution.steps.find((s) => s.stepId === execution.currentStepId);
      if (running) {
        const nodeId = sanitize(running.agentId ?? `step_${running.stepId}`);
        const node = graph.nodes.find((n) => n.id === nodeId);
        if (node) node.status = 'running';
        graph.activeAgentId = nodeId;
      }
    }

    return graph;
  }

  buildFromPlugin(record: InstalledPluginRecord): AgentGraph {
    const nodes: AgentNode[] = [];
    const edges: AgentEdge[] = [];
    const edgeKeys = new Set<string>();

    const phases = record.phases ?? [];

    if (phases.length > 0) {
      let prev: AgentNode | null = null;
      for (const phaseName of phases) {
        const nodeId = sanitize(phaseName);
        const node: AgentNode = {
          id: nodeId,
          agentId: phaseName,
          label: phaseName,
          stepCount: 1,
          status: 'planned',
          phase: phaseName,
        };
        nodes.push(node);
        if (prev) _addEdge(edges, edgeKeys, prev.id, nodeId);
        prev = node;
      }
    } else if (record.agentCount) {
      const orchId = 'orchestrator';
      nodes.push({
        id: orchId,
        agentId: orchId,
        label: `Orchestrator × ${record.agentCount.orchestrators}`,
        stepCount: record.agentCount.orchestrators,
        status: 'planned',
      });
      if (record.agentCount.specialists > 0) {
        const specId = 'specialists';
        nodes.push({
          id: specId,
          agentId: specId,
          label: `Specialists × ${record.agentCount.specialists}`,
          stepCount: record.agentCount.specialists,
          status: 'planned',
        });
        _addEdge(edges, edgeKeys, orchId, specId);
      }
    } else {
      const nodeId = sanitize(record.name);
      nodes.push({
        id: nodeId,
        agentId: record.name,
        label: record.name,
        stepCount: 1,
        status: 'planned',
      });
    }

    return { nodes, edges, edgeIndex: buildEdgeIndex(edges) };
  }

  buildFromWorkflow(workflow: Workflow): AgentGraph {
    return this._collapseSteps(
      workflow.steps,
      (s) => s.agentId ?? `step_${s.id}`,
      () => 'planned',
      (s) => s.agentId ?? s.name,
      (s) => s.phase,
    );
  }

  toMermaid(graph: AgentGraph): { dsl: string; edgeIndex: Record<string, string> } {
    const lines: string[] = ['flowchart LR'];

    lines.push('  classDef planned  fill:#2d2d2d,stroke:#555,color:#aaa');
    lines.push('  classDef pending  fill:#3a3a3a,stroke:#666,color:#999');
    lines.push('  classDef running  fill:#0d4a2a,stroke:#2ea043,color:#fff,stroke-width:3px');
    lines.push('  classDef done     fill:#0d3060,stroke:#58a6ff,color:#fff');
    lines.push('  classDef error    fill:#4a0d0d,stroke:#f85149,color:#fff');
    lines.push('  classDef skipped  fill:#2a2a2a,stroke:#444,color:#555');
    lines.push('');

    for (const node of graph.nodes) {
      const badge = node.stepCount > 1 ? ` ×${node.stepCount}` : '';
      const phaseTag = node.phase ? `\\n[${node.phase}]` : '';
      lines.push(`  ${node.id}["${node.label}${badge}${phaseTag}"]`);
    }
    lines.push('');

    for (const edge of graph.edges) {
      lines.push(`  ${edge.from} --> ${edge.to}`);
    }
    lines.push('');

    for (const node of graph.nodes) {
      lines.push(`  class ${node.id} ${node.status}`);
    }

    return { dsl: lines.join('\n'), edgeIndex: graph.edgeIndex };
  }

  /**
   * Collapse an ordered step list into agent nodes, merging consecutive steps
   * with the same agentId into a single node with a step-count badge.
   */
  private _collapseSteps<S>(
    steps: S[],
    getId: (s: S) => string,
    getStatus: (s: S) => AgentNode['status'],
    getLabel: (s: S) => string,
    getPhase?: (s: S) => string | undefined,
  ): AgentGraph {
    const nodes: AgentNode[] = [];
    const edges: AgentEdge[] = [];
    const edgeKeys = new Set<string>();
    const nodeMap = new Map<string, AgentNode>();
    let prev: AgentNode | null = null;

    for (const step of steps) {
      const rawId = getId(step);
      const nodeId = sanitize(rawId);
      const existing = nodeMap.get(nodeId);

      if (existing) {
        existing.status = mergeStatus(existing.status, getStatus(step));
        existing.stepCount += 1;
        existing.label = `${existing.agentId} (${existing.stepCount} steps)`;
        if (prev && prev.id !== nodeId) {
          _addEdge(edges, edgeKeys, prev.id, nodeId);
          prev = existing;
        }
      } else {
        const node: AgentNode = {
          id: nodeId,
          agentId: rawId,
          label: getLabel(step),
          stepCount: 1,
          status: getStatus(step),
          phase: getPhase?.(step),
        };
        nodes.push(node);
        nodeMap.set(nodeId, node);
        if (prev) _addEdge(edges, edgeKeys, prev.id, nodeId);
        prev = node;
      }
    }

    return { nodes, edges, edgeIndex: buildEdgeIndex(edges) };
  }
}

type NodeStatus = AgentNode['status'];

const STEP_TO_NODE_STATUS: Record<StepExecution['status'], NodeStatus> = {
  pending: 'pending',
  running: 'running',
  done:    'done',
  error:   'error',
  skipped: 'skipped',
};

function stepStatusToNodeStatus(s: StepExecution['status']): NodeStatus {
  return STEP_TO_NODE_STATUS[s] ?? 'pending';
}

const STATUS_RANK: Record<NodeStatus, number> = {
  error:   5,
  running: 4,
  done:    3,
  skipped: 2,
  pending: 1,
  planned: 0,
};

function mergeStatus(a: NodeStatus, b: NodeStatus): NodeStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

function _addEdge(edges: AgentEdge[], seen: Set<string>, from: string, to: string): void {
  const key = edgeKey(from, to);
  if (!seen.has(key)) {
    seen.add(key);
    edges.push({ from, to, key });
  }
}

function buildEdgeIndex(edges: AgentEdge[]): Record<string, string> {
  const index: Record<string, string> = {};
  for (const edge of edges) {
    // Mermaid renders edge ids as L-<from>-<to>-<n> (n=0 for the first edge between a pair)
    index[edge.key] = `L-${edge.from}-${edge.to}-0`;
  }
  return index;
}
