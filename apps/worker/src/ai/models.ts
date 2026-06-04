// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * Model tier definitions and resolution.
 *
 * Three tiers mapped to capability levels:
 * - "small"  (Haiku — summarization, structured extraction)
 * - "medium" (Sonnet — tool use, general analysis)
 * - "large"  (Opus — deep reasoning, complex analysis)
 *
 * Users override Claude tiers via ANTHROPIC_SMALL_MODEL / ANTHROPIC_MEDIUM_MODEL / ANTHROPIC_LARGE_MODEL,
 * which works across Claude providers (direct, Bedrock, Vertex).
 *
 * Codex tiers are optional. When CODEX_*_MODEL is unset, Shannon lets the Codex CLI
 * choose its configured default model so account/workspace policy can govern it.
 */

export type ModelTier = 'small' | 'medium' | 'large';

const DEFAULT_MODELS: Readonly<Record<ModelTier, string>> = {
  small: 'claude-haiku-4-5-20251001',
  medium: 'claude-sonnet-4-6',
  large: 'claude-opus-4-7',
};

/** Resolve a model tier to a concrete model ID. */
export function resolveModel(tier: ModelTier = 'medium'): string {
  switch (tier) {
    case 'small':
      return process.env.ANTHROPIC_SMALL_MODEL || DEFAULT_MODELS.small;
    case 'large':
      return process.env.ANTHROPIC_LARGE_MODEL || DEFAULT_MODELS.large;
    default:
      return process.env.ANTHROPIC_MEDIUM_MODEL || DEFAULT_MODELS.medium;
  }
}

/** Resolve a Codex model tier, or undefined to let Codex choose its configured default. */
export function resolveCodexModel(tier: ModelTier = 'medium'): string | undefined {
  switch (tier) {
    case 'small':
      return process.env.CODEX_SMALL_MODEL || process.env.CODEX_MODEL || undefined;
    case 'large':
      return process.env.CODEX_LARGE_MODEL || process.env.CODEX_MODEL || undefined;
    default:
      return process.env.CODEX_MEDIUM_MODEL || process.env.CODEX_MODEL || undefined;
  }
}

/** Whether a model supports adaptive thinking. Opus 4.6 and 4.7 only. */
export function supportsAdaptiveThinking(model: string): boolean {
  return /opus-4-[67]/.test(model);
}
