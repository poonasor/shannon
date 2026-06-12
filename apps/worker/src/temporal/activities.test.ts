// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldPreserveDirectDeliverableOnCollectorMiss } from './activities.js';

describe('collector miss preservation', () => {
  it('keeps substantive direct markdown when every collector tool was skipped', () => {
    const markdown = [
      '# Authentication Analysis Report',
      '',
      '## 1. Executive Summary',
      '',
      'The analysis identified authentication weaknesses with concrete code evidence. The session handler accepts',
      'pre-authentication session identifiers and does not rotate them after successful login, which leaves a',
      'session fixation path for attackers who can plant a known identifier before the victim authenticates.',
      '',
      '## 2. Dominant Vulnerability Patterns',
      '',
      'The same missing state transition validation appears across multiple authentication flows, including login,',
      'password reset, and OAuth callback handling. These are substantive findings that should not be replaced by',
      'collector placeholders when the provider cannot call MCP tools.',
    ].join('\n');

    const preserve = shouldPreserveDirectDeliverableOnCollectorMiss(
      {
        set_findings_summary: 'skipped',
        set_strategic_intelligence: { calls: 0 },
        set_safe_vectors: { calls: 0 },
      },
      markdown,
    );

    assert.equal(preserve, true);
  });

  it('does not preserve placeholder-only markdown', () => {
    const preserve = shouldPreserveDirectDeliverableOnCollectorMiss(
      { set_findings_summary: 'skipped' },
      '# Authentication Analysis Report\n\n_[Section 1: not provided — `set_findings_summary` was not called]_',
    );

    assert.equal(preserve, false);
  });
});
