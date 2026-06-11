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

function substantiveMarkdown() {
  return `# Pre-Recon Report\n\n## Architecture\nThe app uses Next.js and Firebase. Session cookies, API routes, Firebase rules, and storage upload paths were reviewed with concrete file references.\n\n## Attack Surface\nPublic API routes and authenticated dashboard routes were mapped with file paths. The fallback deliverable contains enough source-grounded detail to guide downstream agents even though the structured collector tools were absent.`;
}

test('preserves a substantive direct deliverable when collector tools were unavailable', () => {
  assert.equal(shouldPreserveDirectDeliverableOnCollectorMiss(allSkipped, substantiveMarkdown()), true);
});

test('preserves a substantive direct deliverable when batched collector tools saw no calls', () => {
  assert.equal(
    shouldPreserveDirectDeliverableOnCollectorMiss(
      {
        set_executive_summary: 'skipped',
        add_endpoints: { calls: 0, endpoints_seen: 0 },
        set_application_intelligence: 'skipped',
      },
      substantiveMarkdown(),
    ),
    true,
  );
});

test('does not preserve direct deliverable when any collector tool was called', () => {
  const markdown = `# Pre-Recon Report\n\n## Architecture\nThe app uses Next.js and Firebase. Session cookies, API routes, Firebase rules, and storage upload paths were reviewed with concrete file references.\n\n## Attack Surface\nPublic API routes and authenticated dashboard routes were mapped with file paths. This content is intentionally long enough to pass the substantive-content length guard, so the called collector status is what prevents preservation.`;

  assert.equal(shouldPreserveDirectDeliverableOnCollectorMiss(withCalledTool, markdown), false);
});

test('does not preserve direct deliverable when a batched collector tool was called', () => {
  assert.equal(
    shouldPreserveDirectDeliverableOnCollectorMiss(
      {
        set_executive_summary: 'skipped',
        add_endpoints: { calls: 1, endpoints_seen: 0 },
        set_application_intelligence: 'skipped',
      },
      substantiveMarkdown(),
    ),
    false,
  );
});

test('preserves substantive direct deliverable that naturally mentions missing controls', () => {
  const markdown = `# Pre-Recon Report\n\n## Findings\nThe upload endpoint rate limiting was not provided by the observed middleware chain, but session-cookie validation and Firebase rule coverage were both mapped with source file references.\n\n## Evidence\nThe report includes concrete route paths, authorization guards, and storage access-control notes from the application source, so it is substantive direct fallback content rather than a collector placeholder.`;

  assert.equal(shouldPreserveDirectDeliverableOnCollectorMiss(allSkipped, markdown), true);
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
