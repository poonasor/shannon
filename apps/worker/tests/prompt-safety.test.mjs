import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const promptPath = join(process.cwd(), 'apps/worker/prompts/exploit-injection.txt');

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
  'exploitation steps',
  'attempted exploitation',
  'how this would be exploited',
  'actual data extracted',
  'exfiltration',
  'exploitation workflow',
  'exploitation process',
  'exploitation task list',
];

test('injection exploitation prompt uses provider-safe defensive validation language', async () => {
  const prompt = await readFile(promptPath, 'utf8');
  const lowerPrompt = prompt.toLowerCase();

  for (const phrase of providerRiskyPhrases) {
    assert.equal(
      lowerPrompt.includes(phrase),
      false,
      `prompt should not contain provider-risky phrase: ${phrase}`,
    );
  }

  assert.match(
    prompt,
    /If the queue is empty|If a queue item is a placeholder/i,
    'prompt should instruct the agent to close empty or placeholder queues safely',
  );
  assert.match(
    prompt,
    /non-destructive/i,
    'prompt should require non-destructive validation evidence',
  );
});
