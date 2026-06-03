import { AssetLoader } from '../services/assetLoader';
import { ScopeService } from '../services/scopeService';
import { CopilotExporter } from '../services/copilotExporter';
import { isNewer } from '../utils/version';

/**
 * Per-asset auto-update: for every repo-installed asset that has auto-update
 * turned ON (per-asset checkbox, OFF by default) and whose registry version is
 * newer than the recorded installed version, re-export it to `.github/` and bump
 * the stored version. Returns the count actually updated. Call after a catalog
 * (re)load.
 *
 * First sighting of an already-installed asset with no recorded version just records
 * a baseline (so it won't spuriously "update" on the next refresh).
 */
export async function autoUpdateAssets(
  assetLoader: AssetLoader,
  scopeService: ScopeService,
  exporter: CopilotExporter,
): Promise<number> {
  let updated = 0;
  const repoIds = scopeService.getRepoScopedIds();
  for (const id of repoIds) {
    if (!scopeService.getAutoUpdate(id)) continue; // per-asset opt-in (default off)
    const asset = assetLoader.getById(id);
    if (!asset) continue;
    const installedVersion = scopeService.getInstalledVersion(id);

    if (!installedVersion) {
      await scopeService.setInstalledVersion(id, asset.version); // baseline
      continue;
    }
    if (isNewer(asset.version, installedVersion)) {
      const result = await exporter.exportOne(id, repoIds);
      if (result.ok) {
        await scopeService.setInstalledVersion(id, asset.version);
        updated++;
      }
    }
  }
  return updated;
}
