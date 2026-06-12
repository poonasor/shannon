// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { appendRunCapabilityLimitation, classifyRuntimeProfile } from './run-capabilities.js';

describe('run capability classification', () => {
  it('labels fresh clone scans as source_only', () => {
    assert.equal(classifyRuntimeProfile(false, false), 'source_only');
  });

  it('labels installed env-capable scans explicitly', () => {
    assert.equal(classifyRuntimeProfile(true, true), 'dependency_env_capable');
  });

  it('appends limitation entries without duplicating them', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'shannon-capabilities-test-'));
    try {
      const snapshotPath = path.join(dir, 'run_capabilities.json');
      await writeFile(
        snapshotPath,
        JSON.stringify(
          {
            provider: 'codex',
            target: { dnsReachable: true, httpReachable: true },
            runtime: {
              profile: 'dependency_env_capable',
              dependenciesPresent: true,
              envFilesPresent: true,
              browserAvailable: true,
            },
            collectors: { mode: 'structured-output' },
            limitations: [],
          },
          null,
          2,
        ),
      );

      await appendRunCapabilityLimitation(dir, 'xss-vuln analysis was blocked');
      await appendRunCapabilityLimitation(dir, 'xss-vuln analysis was blocked');

      const updated = JSON.parse(await readFile(snapshotPath, 'utf8')) as { limitations: string[] };
      assert.deepEqual(updated.limitations, ['xss-vuln analysis was blocked']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
