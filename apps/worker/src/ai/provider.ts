// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import type { ProviderConfig } from '../types/config.js';

const CODEX_PROVIDER_NAMES = new Set(['codex', 'codex_cli', 'openai_codex']);

/** Returns true when this run should use the Codex CLI executor. */
export function isCodexProvider(providerConfig?: ProviderConfig): boolean {
  const providerType = providerConfig?.providerType ?? process.env.SHANNON_AI_PROVIDER;
  return CODEX_PROVIDER_NAMES.has((providerType ?? '').toLowerCase());
}

/** Human-readable provider name for logs. */
export function describeProvider(providerConfig?: ProviderConfig): string {
  return isCodexProvider(providerConfig) ? 'codex' : providerConfig?.providerType || 'anthropic_api';
}
