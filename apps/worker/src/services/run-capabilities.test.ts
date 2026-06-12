// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyRuntimeProfile } from './run-capabilities.js';

describe('run capability classification', () => {
  it('labels fresh clone scans as source_only', () => {
    assert.equal(classifyRuntimeProfile(false, false), 'source_only');
  });

  it('labels installed env-capable scans explicitly', () => {
    assert.equal(classifyRuntimeProfile(true, true), 'dependency_env_capable');
  });
});
