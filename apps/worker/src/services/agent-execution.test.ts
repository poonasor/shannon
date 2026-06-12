// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isProviderSafetyBlockMessage } from './agent-execution.js';

describe('agent execution provider safety classification', () => {
  it('detects Codex cybersecurity safety blocks', () => {
    assert.equal(
      isProviderSafetyBlockMessage(
        'This content was flagged for possible cybersecurity risk. Join the Trusted Access for Cyber program.',
      ),
      true,
    );
  });

  it('does not classify ordinary execution failures as provider safety blocks', () => {
    assert.equal(isProviderSafetyBlockMessage('Command failed with exit code 1'), false);
  });
});
