// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * Codex CLI agent execution.
 *
 * This path intentionally runs Codex through `codex exec` account auth instead
 * of mapping ChatGPT/Codex subscriptions onto Shannon's LLM API-key layer.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AuditSession } from '../audit/index.js';
import { deliverablesDir } from '../paths.js';
import { isRetryableError, PentestError } from '../services/error-handling.js';
import type { ActivityLogger } from '../types/activity-logger.js';
import type { ProviderConfig } from '../types/config.js';
import { isSpendingCapBehavior } from '../utils/billing-detection.js';
import { formatTimestamp } from '../utils/formatting.js';
import { Timer } from '../utils/metrics.js';
import { createAuditLogger } from './audit-logger.js';
import { type ModelTier, resolveCodexModel } from './models.js';
import {
  detectExecutionContext,
  formatAssistantOutput,
  formatCompletionMessage,
  formatErrorOutput,
} from './output-formatters.js';
import { createProgressManager } from './progress-manager.js';
import type { JsonSchemaOutputFormat, PromptResult } from './types.js';

declare global {
  var SHANNON_DISABLE_LOADER: boolean | undefined;
}

type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

interface CodexEvent {
  type?: string;
  item?: unknown;
  message?: unknown;
  error?: unknown;
  model?: unknown;
  usage?: unknown;
  [key: string]: unknown;
}

interface CodexRunResult {
  stdoutEvents: CodexEvent[];
  stderr: string;
  exitCode: number;
}

function outputLines(lines: string[]): void {
  for (const line of lines) {
    console.log(line);
  }
}

function getCodexSandbox(providerConfig?: ProviderConfig): CodexSandbox {
  const configured = providerConfig?.codexSandbox ?? process.env.SHANNON_CODEX_SANDBOX ?? 'workspace-write';
  if (configured === 'read-only' || configured === 'workspace-write' || configured === 'danger-full-access') {
    return configured;
  }

  throw new PentestError(
    `Invalid SHANNON_CODEX_SANDBOX value "${configured}". Expected read-only, workspace-write, or danger-full-access.`,
    'config',
    false,
  );
}

function envValue(name: string, providerConfig?: ProviderConfig): string | undefined {
  switch (name) {
    case 'CODEX_ACCESS_TOKEN':
      return providerConfig?.codexAccessToken ?? process.env.CODEX_ACCESS_TOKEN;
    case 'CODEX_HOME':
      return providerConfig?.codexOAuthHome ?? process.env.CODEX_HOME;
    default:
      return process.env[name];
  }
}

function copyEnvValue(target: Record<string, string>, name: string, providerConfig?: ProviderConfig): void {
  const value = envValue(name, providerConfig);
  if (value) {
    target[name] = value;
  }
}

export function buildCodexEnv(
  sourceDir: string,
  deliverablesSubdir: string | undefined,
  providerConfig?: ProviderConfig,
): Record<string, string> {
  const env: Record<string, string> = {
    HOME: process.env.HOME || '/tmp',
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    PLAYWRIGHT_MCP_OUTPUT_DIR: deliverablesSubdir
      ? path.join(sourceDir, path.dirname(deliverablesSubdir), '.playwright-cli')
      : path.join(sourceDir, '.shannon', '.playwright-cli'),
    ...(deliverablesSubdir && { SHANNON_DELIVERABLES_SUBDIR: deliverablesSubdir }),
  };

  const passthroughVars = [
    'CODEX_ACCESS_TOKEN',
    'CODEX_HOME',
    'CODEX_CA_CERTIFICATE',
    'SSL_CERT_FILE',
    'PLAYWRIGHT_MCP_EXECUTABLE_PATH',
    'SHANNON_DOCKER',
    'XDG_CACHE_HOME',
    'XDG_CONFIG_HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
  ];

  for (const name of passthroughVars) {
    copyEnvValue(env, name, providerConfig);
  }

  return env;
}

async function writeErrorLog(
  err: Error & { code?: string; status?: number },
  sourceDir: string,
  fullPrompt: string,
  duration: number,
): Promise<void> {
  try {
    const errorLog = {
      timestamp: formatTimestamp(),
      agent: 'codex-executor',
      error: {
        name: err.constructor.name,
        message: err.message,
        code: err.code,
        status: err.status,
        stack: err.stack,
      },
      context: {
        sourceDir,
        prompt: `${fullPrompt.slice(0, 200)}...`,
        retryable: isRetryableError(err),
      },
      duration,
    };
    const logPath = path.join(deliverablesDir(sourceDir), 'error.log');
    await writeFile(logPath, `${JSON.stringify(errorLog)}\n`, { flag: 'a' });
  } catch {
    // Best-effort error log writing - don't propagate failures
  }
}

function extractItemText(item: unknown): string | null {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const record = item as Record<string, unknown>;
  if (typeof record.text === 'string') {
    return record.text;
  }
  if (typeof record.content === 'string') {
    return record.content;
  }
  if (Array.isArray(record.content)) {
    const parts = record.content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') {
          return (part as Record<string, string>).text;
        }
        return null;
      })
      .filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join('\n') : null;
  }

  return null;
}

function extractAssistantText(event: CodexEvent): string | null {
  const item = event.item;
  if (!item || typeof item !== 'object') {
    return null;
  }

  const itemType = (item as Record<string, unknown>).type;
  if (itemType !== 'agent_message' && itemType !== 'assistant_message' && itemType !== 'message') {
    return null;
  }

  return extractItemText(item);
}

function extractEventError(event: CodexEvent): string | null {
  if (typeof event.message === 'string') return event.message;
  if (typeof event.error === 'string') return event.error;
  if (event.error && typeof event.error === 'object') {
    const record = event.error as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
  }
  return null;
}

function parseJsonlLine(line: string, logger: ActivityLogger): CodexEvent | null {
  if (!line.trim()) {
    return null;
  }

  try {
    return JSON.parse(line) as CodexEvent;
  } catch {
    logger.warn(`Ignoring non-JSON Codex stdout line: ${line.slice(0, 160)}`);
    return null;
  }
}

async function spawnCodexExec(
  args: string[],
  stdin: string,
  env: Record<string, string>,
  logger: ActivityLogger,
): Promise<CodexRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdoutEvents: CodexEvent[] = [];
    const stderrChunks: string[] = [];
    let stdoutBuffer = '';

    child.on('error', reject);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const parsed = parseJsonlLine(line, logger);
        if (parsed) {
          stdoutEvents.push(parsed);
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString('utf8'));
    });

    child.on('close', (code) => {
      if (stdoutBuffer.trim()) {
        const parsed = parseJsonlLine(stdoutBuffer, logger);
        if (parsed) {
          stdoutEvents.push(parsed);
        }
      }
      resolve({
        stdoutEvents,
        stderr: stderrChunks.join(''),
        exitCode: code ?? 1,
      });
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}

async function runCodexProcess(
  fullPrompt: string,
  sourceDir: string,
  model: string | undefined,
  outputFormat: JsonSchemaOutputFormat | undefined,
  providerConfig: ProviderConfig | undefined,
  deliverablesSubdir: string | undefined,
  logger: ActivityLogger,
): Promise<{ run: CodexRunResult; lastMessage: string; structuredOutput?: unknown }> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'shannon-codex-'));
  const lastMessagePath = path.join(tempDir, 'last-message.txt');
  const schemaPath = path.join(tempDir, 'output-schema.json');

  try {
    const args = [
      'exec',
      '--json',
      '--ephemeral',
      '--cd',
      sourceDir,
      '--sandbox',
      getCodexSandbox(providerConfig),
      '--skip-git-repo-check',
      '-o',
      lastMessagePath,
    ];

    if (providerConfig?.codexIgnoreUserConfig || process.env.SHANNON_CODEX_IGNORE_USER_CONFIG === 'true') {
      args.push('--ignore-user-config');
    }
    if (providerConfig?.codexIgnoreRules || process.env.SHANNON_CODEX_IGNORE_RULES === 'true') {
      args.push('--ignore-rules');
    }
    if (model) {
      args.push('-m', model);
    }
    if (outputFormat) {
      await writeFile(schemaPath, JSON.stringify(outputFormat.schema, null, 2), 'utf8');
      args.push('--output-schema', schemaPath);
    }

    args.push('-');

    const run = await spawnCodexExec(
      args,
      fullPrompt,
      buildCodexEnv(sourceDir, deliverablesSubdir, providerConfig),
      logger,
    );
    let lastMessage = '';
    try {
      lastMessage = await readFile(lastMessagePath, 'utf8');
    } catch {
      lastMessage = '';
    }

    if (run.exitCode !== 0) {
      return { run, lastMessage };
    }

    if (!outputFormat) {
      return { run, lastMessage };
    }

    let structuredOutput: unknown;
    try {
      structuredOutput = JSON.parse(lastMessage);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new PentestError(`Codex returned invalid structured output: ${detail}`, 'validation', true);
    }

    return { run, lastMessage, structuredOutput };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function runCodexPrompt(
  prompt: string,
  sourceDir: string,
  context: string = '',
  description: string = 'Codex analysis',
  _agentName: string | null = null,
  auditSession: AuditSession | null = null,
  logger: ActivityLogger,
  modelTier: ModelTier = 'medium',
  outputFormat?: JsonSchemaOutputFormat,
  _apiKey?: string,
  deliverablesSubdir?: string,
  providerConfig?: ProviderConfig,
): Promise<PromptResult> {
  const timer = new Timer(`agent-${description.toLowerCase().replace(/\s+/g, '-')}`);
  const fullPrompt = context ? `${context}\n\n${prompt}` : prompt;
  const execContext = detectExecutionContext(description);
  const progress = createProgressManager(
    { description, useCleanOutput: execContext.useCleanOutput },
    global.SHANNON_DISABLE_LOADER ?? false,
  );
  const auditLogger = createAuditLogger(auditSession);
  const model = providerConfig?.modelOverrides?.[modelTier] ?? resolveCodexModel(modelTier);

  logger.info(`Running Codex CLI: ${description}...`);
  if (!execContext.useCleanOutput) {
    logger.info(`Codex Options: cwd=${sourceDir}, sandbox=${getCodexSandbox(providerConfig)}`);
  }

  let turnCount = 0;
  let result: string | null = null;
  const totalCost = 0;
  const apiErrorDetected = false;

  progress.start();

  try {
    const { run, lastMessage, structuredOutput } = await runCodexProcess(
      fullPrompt,
      sourceDir,
      model,
      outputFormat,
      providerConfig,
      deliverablesSubdir,
      logger,
    );

    for (const event of run.stdoutEvents) {
      if (event.type === 'turn.started') {
        turnCount++;
      }
      if (event.type === 'error' || event.type === 'turn.failed') {
        const message = extractEventError(event) ?? `Codex emitted ${event.type}`;
        throw new PentestError(message, 'validation', true);
      }

      const assistantText = extractAssistantText(event);
      if (assistantText?.trim()) {
        result = assistantText;
        const turn = Math.max(turnCount, 1);
        progress.stop();
        outputLines(formatAssistantOutput(assistantText, execContext, turn, description));
        progress.start();
        await auditLogger.logLlmResponse(turn, assistantText);
      }

      if (typeof event.model === 'string' && !model) {
        logger.info(`Codex model: ${event.model}`);
      }
    }

    if (run.exitCode !== 0) {
      const detail = run.stderr.trim() || `codex exec exited with code ${run.exitCode}`;
      throw new PentestError(detail, 'validation', true);
    }

    result = lastMessage.trim() || result;

    if (isSpendingCapBehavior(turnCount, totalCost, result || run.stderr)) {
      throw new PentestError(
        `Codex usage limit likely reached (turns=${turnCount}, cost=$0): ${(result || run.stderr).slice(0, 100)}`,
        'billing',
        true,
      );
    }

    const duration = timer.stop();
    progress.finish(formatCompletionMessage(execContext, description, Math.max(turnCount, 1), duration));

    return {
      result,
      success: true,
      duration,
      turns: Math.max(turnCount, 1),
      cost: totalCost,
      model: model ?? 'codex-default',
      partialCost: totalCost,
      apiErrorDetected,
      ...(structuredOutput !== undefined && { structuredOutput }),
    };
  } catch (error) {
    const duration = timer.stop();
    const err = error as Error & { code?: string; status?: number };
    await auditLogger.logError(err, duration, turnCount);
    progress.stop();
    outputLines(formatErrorOutput(err, execContext, description, duration, sourceDir, isRetryableError(err)));
    await writeErrorLog(err, sourceDir, fullPrompt, duration);

    return {
      error: err.message,
      errorType: err.constructor.name,
      prompt: `${fullPrompt.slice(0, 100)}...`,
      success: false,
      duration,
      cost: totalCost,
      retryable: isRetryableError(err),
    };
  }
}

export function parseCodexJsonlForTests(lines: string[], logger: ActivityLogger): CodexEvent[] {
  return lines.map((line) => parseJsonlLine(line, logger)).filter((event): event is CodexEvent => event !== null);
}
