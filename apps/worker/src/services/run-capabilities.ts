// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * Runtime capability snapshot for a Shannon scan.
 *
 * The snapshot records only presence/absence and reachability facts. It never
 * serializes environment variable values or credential material.
 */

import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { access, readdir } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { promisify } from 'node:util';
import { describeProvider, isCodexProvider } from '../ai/provider.js';
import { deliverablesDir } from '../paths.js';
import type { ActivityLogger } from '../types/activity-logger.js';
import type { ProviderConfig } from '../types/config.js';
import { atomicWrite, ensureDirectory, fileExists, readJson } from '../utils/file-io.js';

const execFileAsync = promisify(execFile);
const SNAPSHOT_FILENAME = 'run_capabilities.json';
const TARGET_TIMEOUT_MS = 5_000;
const ENV_FILE_NAMES = ['.env', '.env.local', '.env.development', '.env.production'];

export type CollectorMode = 'mcp' | 'structured-output' | 'direct-markdown';
export type RuntimeProfile = 'source_only' | 'dependency_env_capable' | 'dependency_only' | 'env_only';

export interface RunCapabilities {
  readonly provider: string;
  readonly target: {
    readonly dnsReachable: boolean;
    readonly httpReachable: boolean;
  };
  readonly runtime: {
    readonly profile: RuntimeProfile;
    readonly dependenciesPresent: boolean;
    readonly envFilesPresent: boolean;
    readonly browserAvailable: boolean;
  };
  readonly collectors: {
    readonly mode: CollectorMode;
  };
  readonly limitations: readonly string[];
}

interface TargetProbe {
  readonly dnsReachable: boolean;
  readonly httpReachable: boolean;
  readonly limitation?: string;
}

function requestHead(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const req = transport.request(
      url,
      {
        method: 'HEAD',
        timeout: TARGET_TIMEOUT_MS,
        ...(parsed.protocol === 'https:' && { rejectUnauthorized: false }),
      },
      (res) => {
        res.resume();
        resolve();
      },
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Connection timed out after ${TARGET_TIMEOUT_MS}ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

async function probeTarget(targetUrl: string): Promise<TargetProbe> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return {
      dnsReachable: false,
      httpReachable: false,
      limitation: 'Target URL is invalid; live validation cannot run.',
    };
  }

  try {
    await lookup(parsed.hostname, { all: true });
  } catch {
    return {
      dnsReachable: false,
      httpReachable: false,
      limitation: 'Target DNS resolution failed from the worker; live validation is unavailable.',
    };
  }

  try {
    await requestHead(targetUrl);
    return { dnsReachable: true, httpReachable: true };
  } catch {
    return {
      dnsReachable: true,
      httpReachable: false,
      limitation: 'Target HTTP reachability failed from the worker; exploit validation may be blocked.',
    };
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync('which', [command], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function hasExecutablePath(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
}

async function detectBrowserAvailability(): Promise<boolean> {
  if (await hasExecutablePath(process.env.PLAYWRIGHT_MCP_EXECUTABLE_PATH)) {
    return true;
  }
  return commandExists('playwright-cli');
}

async function detectDependencies(repoPath: string): Promise<boolean> {
  if (await fileExists(path.join(repoPath, 'node_modules'))) {
    return true;
  }

  try {
    const entries = await readdir(repoPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.git' || entry.name === '.shannon' || entry.name === 'node_modules') continue;
      if (await fileExists(path.join(repoPath, entry.name, 'node_modules'))) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

async function detectEnvFiles(repoPath: string): Promise<boolean> {
  for (const fileName of ENV_FILE_NAMES) {
    if (await fileExists(path.join(repoPath, fileName))) {
      return true;
    }
  }
  return false;
}

function collectorModeForProvider(providerConfig?: ProviderConfig): CollectorMode {
  return isCodexProvider(providerConfig) ? 'structured-output' : 'mcp';
}

export function classifyRuntimeProfile(dependenciesPresent: boolean, envFilesPresent: boolean): RuntimeProfile {
  if (dependenciesPresent && envFilesPresent) {
    return 'dependency_env_capable';
  }
  if (dependenciesPresent) {
    return 'dependency_only';
  }
  if (envFilesPresent) {
    return 'env_only';
  }
  return 'source_only';
}

export async function detectRunCapabilities(
  repoPath: string,
  targetUrl: string,
  providerConfig: ProviderConfig | undefined,
): Promise<RunCapabilities> {
  const [target, dependenciesPresent, envFilesPresent, browserAvailable] = await Promise.all([
    probeTarget(targetUrl),
    detectDependencies(repoPath),
    detectEnvFiles(repoPath),
    detectBrowserAvailability(),
  ]);
  const profile = classifyRuntimeProfile(dependenciesPresent, envFilesPresent);

  const limitations: string[] = [];
  if (profile === 'source_only') {
    limitations.push('Run profile is source_only; runtime validation depends on target/browser reachability only.');
  }
  if (target.limitation) {
    limitations.push(target.limitation);
  }
  if (!dependenciesPresent) {
    limitations.push('Project dependencies are not installed; runtime-dependent checks may be source-only.');
  }
  if (!envFilesPresent) {
    limitations.push('No .env-style file is present; authenticated or configured runtime paths may be unavailable.');
  }
  if (!browserAvailable) {
    limitations.push('Browser automation is unavailable in the worker; browser-based validation is blocked.');
  }
  if (isCodexProvider(providerConfig)) {
    limitations.push(
      'Codex does not receive Claude SDK in-process MCP collectors; structured output and direct markdown are authoritative.',
    );
  }

  return {
    provider: describeProvider(providerConfig),
    target: {
      dnsReachable: target.dnsReachable,
      httpReachable: target.httpReachable,
    },
    runtime: {
      profile,
      dependenciesPresent,
      envFilesPresent,
      browserAvailable,
    },
    collectors: {
      mode: collectorModeForProvider(providerConfig),
    },
    limitations,
  };
}

export async function writeRunCapabilitiesSnapshot(
  repoPath: string,
  deliverablesSubdir: string | undefined,
  targetUrl: string,
  providerConfig: ProviderConfig | undefined,
  logger: ActivityLogger,
): Promise<RunCapabilities> {
  const snapshot = await detectRunCapabilities(repoPath, targetUrl, providerConfig);
  const dir = deliverablesDir(repoPath, deliverablesSubdir);
  const snapshotPath = path.join(dir, SNAPSHOT_FILENAME);

  await ensureDirectory(dir);
  await atomicWrite(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  logger.info(`Wrote ${SNAPSHOT_FILENAME}`, {
    provider: snapshot.provider,
    dnsReachable: snapshot.target.dnsReachable,
    httpReachable: snapshot.target.httpReachable,
    collectorMode: snapshot.collectors.mode,
    limitationCount: snapshot.limitations.length,
  });

  return snapshot;
}

export async function readRunCapabilitiesFromDeliverables(deliverablesPath: string): Promise<RunCapabilities | null> {
  const snapshotPath = path.join(deliverablesPath, SNAPSHOT_FILENAME);
  if (!(await fileExists(snapshotPath))) {
    return null;
  }
  return readJson<RunCapabilities>(snapshotPath);
}

export async function readRunCapabilities(
  repoPath: string,
  deliverablesSubdir: string | undefined,
): Promise<RunCapabilities | null> {
  return readRunCapabilitiesFromDeliverables(deliverablesDir(repoPath, deliverablesSubdir));
}

export function renderRunCapabilitiesForPrompt(snapshot: RunCapabilities | null): string {
  if (!snapshot) {
    return '- Run capability snapshot: not yet available.';
  }

  const lines = [
    `- Provider: ${snapshot.provider}`,
    `- Collector mode: ${snapshot.collectors.mode}`,
    `- Runtime profile: ${snapshot.runtime.profile}`,
    `- Target DNS reachable: ${snapshot.target.dnsReachable}`,
    `- Target HTTP reachable: ${snapshot.target.httpReachable}`,
    `- Dependencies present: ${snapshot.runtime.dependenciesPresent}`,
    `- Env files present: ${snapshot.runtime.envFilesPresent}`,
    `- Browser available: ${snapshot.runtime.browserAvailable}`,
  ];

  if (snapshot.limitations.length > 0) {
    lines.push('- Limitations:');
    for (const limitation of snapshot.limitations) {
      lines.push(`  - ${limitation}`);
    }
  } else {
    lines.push('- Limitations: none detected.');
  }

  return lines.join('\n');
}
