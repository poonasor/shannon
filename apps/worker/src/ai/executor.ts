// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import type { AuditSession } from '../audit/index.js';
import type { ActivityLogger } from '../types/activity-logger.js';
import type { ProviderConfig } from '../types/config.js';
import { type ClaudePromptResult, runClaudePrompt, validateAgentOutput } from './claude-executor.js';
import { runCodexPrompt } from './codex-executor.js';
import type { ModelTier } from './models.js';
import { isCodexProvider } from './provider.js';
import type { JsonSchemaOutputFormat, PromptResult } from './types.js';

export type { PromptResult };
export { validateAgentOutput };

/** Run an agent prompt with the configured provider. */
export async function runAgentPrompt(
  prompt: string,
  sourceDir: string,
  context: string = '',
  description: string = 'Agent analysis',
  agentName: string | null = null,
  auditSession: AuditSession | null = null,
  logger: ActivityLogger,
  modelTier: ModelTier = 'medium',
  outputFormat?: JsonSchemaOutputFormat,
  apiKey?: string,
  deliverablesSubdir?: string,
  providerConfig?: ProviderConfig,
  mcpServers?: Record<string, import('@anthropic-ai/claude-agent-sdk').McpServerConfig>,
): Promise<PromptResult> {
  if (isCodexProvider(providerConfig)) {
    return runCodexPrompt(
      prompt,
      sourceDir,
      context,
      description,
      agentName,
      auditSession,
      logger,
      modelTier,
      outputFormat,
      apiKey,
      deliverablesSubdir,
      providerConfig,
    );
  }

  return runClaudePrompt(
    prompt,
    sourceDir,
    context,
    description,
    agentName,
    auditSession,
    logger,
    modelTier,
    outputFormat,
    apiKey,
    deliverablesSubdir,
    providerConfig,
    mcpServers,
  ) as Promise<ClaudePromptResult>;
}
