import { readFile, writeFile, chmod } from "fs/promises";
import { config, ensureDataDir } from "@/utils/config";

export interface ArcSettings {
  nvidiaApiKey?: string;
}

export async function loadSettings(): Promise<ArcSettings> {
  try {
    const data = await readFile(config.paths.settingsFile, "utf-8");
    return JSON.parse(data) as ArcSettings;
  } catch {
    return {};
  }
}

export async function saveSettings(settings: ArcSettings): Promise<boolean> {
  try {
    await ensureDataDir();
    await writeFile(config.paths.settingsFile, JSON.stringify(settings, null, 2), {
      mode: config.storage.settingsFileMode,
    });
    await chmod(config.paths.settingsFile, config.storage.settingsFileMode);
    return true;
  } catch {
    return false;
  }
}
