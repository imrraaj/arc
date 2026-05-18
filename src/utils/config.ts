import { mkdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { WORKSPACE_ROOT } from "@/utils/workspace";
import { prompts } from "@/prompts";

const arcHomeDir = join(homedir(), ".arc");
const arcSettingsFile = join(arcHomeDir, "config.json");
const arcDatabaseFile = join(arcHomeDir, "arc.db");

const availableModels = [
    "qwen/qwen3.5-122b-a10b",
    "moonshotai/kimi-k2.6",
    "z-ai/glm-5.1",
    "minimaxai/minimax-m2.7",
    "meta/llama-3_3-70b-instruct",

] as const;

export const config = {
    appName: "arc",
    version: "0.2.0",
    defaultModel: availableModels[0],
    availableModels,

    paths: {
        dataDir: arcHomeDir,
        settingsFile: arcSettingsFile,
        databaseFile: arcDatabaseFile,
    },

    storage: {
        directoryMode: 0o700,
        settingsFileMode: 0o600,
    },

    memory: {
        windowSize: 10,
        contextWindow: 32000,
        safetyBuffer: 2000,
        compactionThreshold: 0.9,
    },

    ui: {
        modelContextWindow: 32768,
        apiKeyStorageLabel: "~/.arc/config.json",
    },

    prompts,

    tools: {
        command: {
            maxOutputBytes: 50_000,
            defaultTimeoutSeconds: 30,
            maxTimeoutSeconds: 120,
            blockedPatterns: [
                /rm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+\//i,
                /\bdd\b.*of=\/dev\//i,
                /\bmkfs\b/i,
                /\bshutdown\b|\breboot\b|\bhalt\b|\bpoweroff\b/i,
                /:\(\)\s*\{.*\|.*&.*\}/,
                /\bsudo\s+rm\b/i,
            ],
        },
        skills: {
            defaultDirectories: [join(WORKSPACE_ROOT, ".agents")],
        },
    },
} as const;

export async function ensureDataDir() {
    await mkdir(config.paths.dataDir, {
        recursive: true,
        mode: config.storage.directoryMode,
    });
}
