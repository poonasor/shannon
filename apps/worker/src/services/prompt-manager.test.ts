// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adaptPromptForCodex } from './prompt-manager.js';

describe('Codex prompt adaptation', () => {
  it('removes Claude-only tooling requirements as completion blockers', () => {
    const prompt = [
      '<cli_tools>',
      '- **Task Agent:** MANDATORY for all source code analysis.',
      '- **TodoWrite Tool:** You MUST use this to track all tasks.',
      '</cli_tools>',
      '',
      '<mcp_tools>',
      'Call every MCP tool exactly once.',
      '</mcp_tools>',
      '',
      '<conclusion_trigger>',
      'MCP Emission and TodoWrite Completion are required before completion.',
      '</conclusion_trigger>',
    ].join('\n');

    const adapted = adaptPromptForCodex(prompt);

    assert.equal(adapted.includes('<mcp_tools>'), false);
    assert.equal(adapted.includes('Task Agent'), false);
    assert.equal(adapted.includes('TodoWrite'), false);
    assert.match(adapted, /final structured JSON output is the authoritative exploitation queue/);
    assert.match(adapted, /Codex Completion Requirements/);
  });
});
