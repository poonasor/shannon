import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldPreserveDirectDeliverableOnCollectorMiss } from '../dist/temporal/activities.js';

const allSkipped = {
  set_executive_summary: 'skipped',
  set_application_intelligence: 'skipped',
  set_auth_deep_dive: 'skipped',
};

const withCalledTool = {
  ...allSkipped,
  set_executive_summary: 'called',
};

test('preserves a substantive direct deliverable when collector tools were unavailable', () => {
  const markdown = `# Pre-Recon Report\n\n## Architecture\nThe app uses Next.js and Firebase. Session cookies, API routes, Firebase rules, and storage upload paths were reviewed with concrete file references.\n\n## Attack Surface\nPublic API routes and authenticated dashboard routes were mapped with file paths. The fallback deliverable contains enough source-grounded detail to guide downstream agents even though the structured collector tools were absent.`;

  assert.equal(shouldPreserveDirectDeliverableOnCollectorMiss(allSkipped, markdown), true);
});

test('does not preserve direct deliverable when any collector tool was called', () => {
  const markdown = '# Pre-Recon Report\n\nSubstantive fallback content.';

  assert.equal(shouldPreserveDirectDeliverableOnCollectorMiss(withCalledTool, markdown), false);
});

test('does not preserve placeholder or empty direct deliverables', () => {
  assert.equal(shouldPreserveDirectDeliverableOnCollectorMiss(allSkipped, ''), false);
  assert.equal(
    shouldPreserveDirectDeliverableOnCollectorMiss(
      allSkipped,
      "# Report\n\n_[Section 1: not provided — `set_executive_summary` was not called]_",
    ),
    false,
  );
});
