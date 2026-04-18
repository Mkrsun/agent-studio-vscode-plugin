import * as yaml from 'js-yaml';
import {
  Asset,
  AssetManifest,
  AssetType,
  AssetSource,
  Workflow,
  Skill,
  Agent,
  Instruction,
  Hook,
} from './types';

const VALID_ASSET_TYPES: AssetType[] = ['skill', 'agent', 'workflow', 'instruction', 'hook'];

export function parseAssetManifest(raw: string, sourcePath: string, source: AssetSource): Asset {
  let parsed: Record<string, unknown>;
  try {
    parsed = yaml.load(raw) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`YAML parse error in ${sourcePath}: ${e}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid manifest at ${sourcePath}: not an object`);
  }

  const manifest = parsed as Partial<AssetManifest>;
  if (!manifest.schemaVersion) {
    throw new Error(`Missing schemaVersion in ${sourcePath}`);
  }
  if (!manifest.asset || typeof manifest.asset !== 'object') {
    throw new Error(`Missing asset field in ${sourcePath}`);
  }

  const raw_asset = manifest.asset as unknown as Record<string, unknown>;
  const required = ['id', 'name', 'type', 'version', 'description'];
  for (const field of required) {
    if (!raw_asset[field]) {
      throw new Error(`Asset in ${sourcePath} is missing required field: ${field}`);
    }
  }

  const type = raw_asset['type'] as string;
  if (!VALID_ASSET_TYPES.includes(type as AssetType)) {
    throw new Error(`Unknown asset type "${type}" in ${sourcePath}`);
  }

  // Inject runtime source
  raw_asset['source'] = source;

  // Validate type-specific required fields
  switch (type) {
    case 'skill':
      validateSkill(raw_asset as Partial<Skill>, sourcePath);
      break;
    case 'agent':
      validateAgent(raw_asset as Partial<Agent>, sourcePath);
      break;
    case 'workflow':
      validateWorkflow(raw_asset as Partial<Workflow>, sourcePath);
      break;
    case 'instruction':
      validateInstruction(raw_asset as Partial<Instruction>, sourcePath);
      break;
    case 'hook':
      validateHook(raw_asset as Partial<Hook>, sourcePath);
      break;
  }

  return raw_asset as unknown as Asset;
}

function validateSkill(asset: Partial<Skill>, sourcePath: string): void {
  if (!asset.systemPrompt) {
    throw new Error(`Skill in ${sourcePath} is missing systemPrompt`);
  }
}

function validateAgent(asset: Partial<Agent>, sourcePath: string): void {
  if (!asset.role) throw new Error(`Agent in ${sourcePath} is missing role`);
  if (!asset.systemPrompt) throw new Error(`Agent in ${sourcePath} is missing systemPrompt`);
  if (!Array.isArray(asset.capabilities)) {
    // Default to empty array rather than error
    asset.capabilities = [];
  }
}

function validateWorkflow(asset: Partial<Workflow>, sourcePath: string): void {
  if (!Array.isArray(asset.steps) || asset.steps.length === 0) {
    throw new Error(`Workflow in ${sourcePath} is missing steps array`);
  }
  if (!asset.entryPhase) {
    throw new Error(`Workflow in ${sourcePath} is missing entryPhase`);
  }
  if (!Array.isArray(asset.phases)) {
    asset.phases = [];
  }
}

function validateInstruction(asset: Partial<Instruction>, sourcePath: string): void {
  if (!asset.content) throw new Error(`Instruction in ${sourcePath} is missing content`);
  if (!asset.scope) asset.scope = 'global';
  if (typeof asset.priority !== 'number') asset.priority = 50;
}

function validateHook(asset: Partial<Hook>, sourcePath: string): void {
  if (!asset.trigger) throw new Error(`Hook in ${sourcePath} is missing trigger`);
  if (!asset.action) throw new Error(`Hook in ${sourcePath} is missing action`);
  if (!asset.payload) throw new Error(`Hook in ${sourcePath} is missing payload`);
}
