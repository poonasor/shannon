import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const promptsDir = join(import.meta.dirname, '..', 'prompts');

// Every exploitation phase runs the same provider-facing validation flow, so all five
// exploit prompts must use defensive "validation" framing rather than the offensive
// language that triggered the original provider refusal. The injection prompt was
// reworded first; the other four were brought in line afterward. This deny-list guards
// all of them.
const exploitPrompts = [
  'exploit-injection.txt',
  'exploit-xss.txt',
  'exploit-auth.txt',
  'exploit-authz.txt',
  'exploit-ssrf.txt',
];

const providerRiskyPhrases = [
  'weaponize',
  'proof of compromise',
  'data exfiltration',
  'remote code execution',
  'reverse shell',
  'what an attacker would do',
  'steal credentials',
  'exfiltrate',
  'proof-of-impact',
  'proof of impact',
  'successfully exploited',
  'exploitation step',
  'exploitation steps',
  'attempted exploitation',
  'how this would be exploited',
  'actual data extracted',
  'exfiltration',
  'exploitation workflow',
  'exploitation process',
  'exploitation task list',
  'intelligence-informed exploitation',
  'injection exploitation',
  'injection exploitation complete',
  'exploitation target requirement',
  'all exploitation must be',
  'critical exploit definition',
  'proof-based exploitation requirements',
  'task-based attack plan',
  'exploit endpoint',
  'full exploitation',
];

for (const promptFile of exploitPrompts) {
  test(`${promptFile} keeps proof-based validation requirements inside the critical section`, async () => {
    const prompt = await readFile(join(promptsDir, promptFile), 'utf8');

    assert.match(
      prompt,
      /<critical>[\s\S]*### PROOF-BASED VALIDATION REQUIREMENTS[\s\S]*<\/critical>/,
      `${promptFile} should put proof-based validation requirements inside <critical>`,
    );
  });

  test(`${promptFile} uses provider-safe defensive validation language`, async () => {
    const prompt = await readFile(join(promptsDir, promptFile), 'utf8');
    const lowerPrompt = prompt.toLowerCase();

    for (const phrase of providerRiskyPhrases) {
      assert.equal(
        lowerPrompt.includes(phrase),
        false,
        `${promptFile} should not contain provider-risky phrase: ${phrase}`,
      );
    }

    assert.match(
      prompt,
      /If the queue is empty|If a queue item is a placeholder/i,
      `${promptFile} should instruct the agent to close empty or placeholder queues safely`,
    );
    assert.match(
      prompt,
      /non-destructive/i,
      `${promptFile} should require non-destructive validation evidence`,
    );
  });
}
