// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractVulnerabilityIds, mergeClassDeliverables, renderResidualFindings } from './reporting.js';

const evidenceOneFinding = [
  '# Authentication Exploitation Evidence',
  '',
  '## Successfully Exploited Vulnerabilities',
  '',
  '### AUTH-VULN-01: Session fixation',
  '',
  '**Summary:**',
  '- **Impact:** Account takeover demonstrated.',
].join('\n');

const placeholderEvidence = [
  '# Authentication Exploitation Evidence',
  '',
  '## Successfully Exploited Vulnerabilities',
  '',
  '*No findings reached a definitive verdict in this category.*',
].join('\n');

const queueFindings = [
  '# Authentication Findings',
  '',
  '## Identified Vulnerabilities',
  '',
  '### AUTH-VULN-01: Session fixation',
  '',
  '**Summary:**',
  '- **Overview:** Session ID is not rotated after login.',
  '',
  '### AUTH-VULN-02: Missing login rate limit',
  '',
  '**Summary:**',
  '- **Overview:** Login endpoint has no throttling.',
].join('\n');

describe('reporting deliverable merge', () => {
  it('extracts vulnerability IDs from markdown headings', () => {
    assert.deepEqual([...extractVulnerabilityIds(queueFindings)], ['AUTH-VULN-01', 'AUTH-VULN-02']);
  });

  it('falls back to queue findings when exploitation evidence is non-substantive', () => {
    const merged = mergeClassDeliverables(placeholderEvidence, queueFindings);

    assert.ok(merged?.includes('### AUTH-VULN-01: Session fixation'));
    assert.ok(merged?.includes('### AUTH-VULN-02: Missing login rate limit'));
    assert.ok(!merged?.includes('No findings reached a definitive verdict'));
  });

  it('appends residual queued findings not covered by exploitation evidence', () => {
    const merged = mergeClassDeliverables(evidenceOneFinding, queueFindings);

    assert.ok(merged?.includes('## Successfully Exploited Vulnerabilities'));
    assert.ok(merged?.includes('### AUTH-VULN-01: Session fixation'));
    assert.ok(merged?.includes('## Identified Vulnerabilities'));
    assert.ok(merged?.includes('### AUTH-VULN-02: Missing login rate limit'));
  });

  it('does not append residual findings already covered by evidence', () => {
    const residual = renderResidualFindings(queueFindings, new Set(['AUTH-VULN-01', 'AUTH-VULN-02']));

    assert.equal(residual, null);
  });
});
