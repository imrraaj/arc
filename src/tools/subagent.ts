import { tool, ToolLoopAgent } from 'ai';
import { z } from 'zod';
import { createDirTool, readDirTool } from './dir';
import { applyPatchTool, createFileTool, readFileTool } from './file';
import { nvidia } from '@/provider';
import { config } from '@/utils/config';


export const subAgentTool = tool({
    description: 'Run a sub-agent with a given prompt and tools',
    inputSchema: z.object({
        prompt: z.string().describe('Prompt to run the sub-agent with'),
        model: z.string().optional().describe('Optional model override for the sub-agent'),
    }),
    needsApproval: true,
    execute: async ({ model, prompt }, { abortSignal, experimental_context }) => {
        const nvidiaApiKey = (experimental_context as { nvidiaApiKey?: string } | undefined)?.nvidiaApiKey;
        if (!nvidiaApiKey) {
            return "Error: NVIDIA API key is not configured.";
        }
        const selectedModel = model?.trim() ? model.trim() : config.defaultModel;
        const agent = new ToolLoopAgent({
            model: nvidia(selectedModel, nvidiaApiKey),
            tools: {
                readFile: readFileTool,
                applyPatch: applyPatchTool,
                createFile: createFileTool,
                createDir: createDirTool,
                readDir: readDirTool,
            },
            instructions: config.prompts.subAgent,
        });
        const response = await agent.generate({
            prompt,
            abortSignal
        });
        return response;
    },
});
