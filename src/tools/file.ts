import { tool } from 'ai';
import { z } from 'zod';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { applyPatch } from 'diff';
import { resolveWorkspacePath } from '@/utils/workspace';

export const applyPatchTool = tool({
  description: 'Apply a unified diff patch to one file in the workspace. Generate the patch first so the user can approve the exact diff.',
  inputSchema: z.object({
    path: z.string().describe('File path relative to project root (or absolute path)'),
    patch: z.string().describe('Unified diff patch for this file'),
  }),
  needsApproval: true,
  execute: async ({ path, patch }) => {
    const resolvedPath = resolveWorkspacePath(path);
    const content = await readFile(resolvedPath, 'utf-8');
    const updated = applyPatch(content, patch, { fuzzFactor: 0 });
    if (updated === false) {
      return {
        ok: false,
        path: resolvedPath,
        error: 'Patch did not apply cleanly',
      };
    }
    await writeFile(resolvedPath, updated);
    return {
      ok: true,
      path: resolvedPath,
      bytesWritten: updated.length,
    };
  },
});

export const readFileTool = tool({
  description: 'Read the content of a file',
  inputSchema: z.object({
    path: z.string().describe('File path relative to project root (or absolute path)'),
  }),
  execute: async ({ path }) => {
    const resolvedPath = resolveWorkspacePath(path);
    const content = await readFile(resolvedPath, 'utf-8');
    return content;
  },
});

export const createFileTool = tool({
  description: 'Create a new file with specified content',
  inputSchema: z.object({
    path: z.string().describe('File path relative to project root (or absolute path)'),
    content: z.string().describe('Content to write to the new file'),
  }),
  needsApproval: true,
  execute: async ({ path, content }) => {
    const resolvedPath = resolveWorkspacePath(path);
    await mkdir(dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, content);
    return `Created file at ${resolvedPath}`;
  },
});
