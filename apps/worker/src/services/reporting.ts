// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

import { fs, path } from 'zx';
import { deliverablesDir } from '../paths.js';
import type { ActivityLogger } from '../types/activity-logger.js';
import { ErrorCode } from '../types/errors.js';
import { PentestError } from './error-handling.js';

interface DeliverableFile {
  name: string;
  evidencePath: string;
  findingsPath: string;
  required: boolean;
}

const VULNERABILITY_HEADING_PATTERN = /^###\s+([A-Z]+-VULN-\d+)\b.*$/gm;

interface FindingBlock {
  readonly id: string;
  readonly text: string;
}

export function extractVulnerabilityIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  for (const match of markdown.matchAll(VULNERABILITY_HEADING_PATTERN)) {
    const id = match[1];
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

export function hasVulnerabilityHeadings(markdown: string | null | undefined): boolean {
  return extractVulnerabilityIds(markdown ?? '').size > 0;
}

function parseFindingBlocks(markdown: string): FindingBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: FindingBlock[] = [];
  let currentId: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = /^###\s+([A-Z]+-VULN-\d+)\b.*$/.exec(line);
    if (match?.[1]) {
      if (currentId && currentLines.length > 0) {
        blocks.push({ id: currentId, text: currentLines.join('\n').trimEnd() });
      }
      currentId = match[1];
      currentLines = [line];
      continue;
    }

    if (currentId) {
      currentLines.push(line);
    }
  }

  if (currentId && currentLines.length > 0) {
    blocks.push({ id: currentId, text: currentLines.join('\n').trimEnd() });
  }

  return blocks;
}

export function renderResidualFindings(findingsMarkdown: string, coveredIds: ReadonlySet<string>): string | null {
  const residualBlocks = parseFindingBlocks(findingsMarkdown).filter((block) => !coveredIds.has(block.id));
  if (residualBlocks.length === 0) {
    return null;
  }

  return ['## Identified Vulnerabilities', '', residualBlocks.map((block) => block.text).join('\n\n')].join('\n');
}

export function mergeClassDeliverables(
  evidenceMarkdown: string | null | undefined,
  findingsMarkdown: string | null | undefined,
): string | null {
  const evidence = evidenceMarkdown?.trimEnd() ?? '';
  const findings = findingsMarkdown?.trimEnd() ?? '';
  const evidenceHasFindings = hasVulnerabilityHeadings(evidence);
  const findingsHasFindings = hasVulnerabilityHeadings(findings);

  if (evidenceHasFindings && findingsHasFindings) {
    const residual = renderResidualFindings(findings, extractVulnerabilityIds(evidence));
    if (residual) {
      return `${evidence}\n\n${residual}\n`;
    }
    return `${evidence}\n`;
  }

  if (evidenceHasFindings) {
    return `${evidence}\n`;
  }

  if (findingsHasFindings) {
    return `${findings}\n`;
  }

  const fallback = evidence || findings;
  return fallback ? `${fallback}\n` : null;
}

async function readOptionalMarkdown(filePath: string, logger: ActivityLogger): Promise<string | null> {
  try {
    if (await fs.pathExists(filePath)) {
      return await fs.readFile(filePath, 'utf8');
    }
  } catch (error) {
    const err = error as Error;
    logger.warn(`Could not read ${path.basename(filePath)}: ${err.message}`);
  }
  return null;
}

// Pure function: Assemble final report from specialist deliverables.
// Per class, prefer substantive exploitation evidence, then append residual
// queue-derived findings that the exploit agent did not cover.
export async function assembleFinalReport(
  sourceDir: string,
  deliverablesSubdir: string | undefined,
  logger: ActivityLogger,
): Promise<string> {
  const deliverableFiles: readonly DeliverableFile[] = [
    {
      name: 'Injection',
      evidencePath: 'injection_exploitation_evidence.md',
      findingsPath: 'injection_findings.md',
      required: false,
    },
    { name: 'XSS', evidencePath: 'xss_exploitation_evidence.md', findingsPath: 'xss_findings.md', required: false },
    {
      name: 'Authentication',
      evidencePath: 'auth_exploitation_evidence.md',
      findingsPath: 'auth_findings.md',
      required: false,
    },
    { name: 'SSRF', evidencePath: 'ssrf_exploitation_evidence.md', findingsPath: 'ssrf_findings.md', required: false },
    {
      name: 'Authorization',
      evidencePath: 'authz_exploitation_evidence.md',
      findingsPath: 'authz_findings.md',
      required: false,
    },
  ];

  const dir = deliverablesDir(sourceDir, deliverablesSubdir);
  const sections: string[] = [];

  for (const file of deliverableFiles) {
    const evidence = await readOptionalMarkdown(path.join(dir, file.evidencePath), logger);
    const findings = await readOptionalMarkdown(path.join(dir, file.findingsPath), logger);
    const merged = mergeClassDeliverables(evidence, findings);

    if (merged) {
      sections.push(merged);
      const evidenceIds = extractVulnerabilityIds(evidence ?? '');
      const findingsIds = extractVulnerabilityIds(findings ?? '');
      const residualCount = [...findingsIds].filter((id) => !evidenceIds.has(id)).length;
      logger.info(`Added ${file.name} section`, {
        evidenceFile: evidence ? file.evidencePath : null,
        findingsFile: findings ? file.findingsPath : null,
        evidenceFindings: evidenceIds.size,
        queueFindings: findingsIds.size,
        residualFindings: evidenceIds.size > 0 ? residualCount : findingsIds.size,
      });
    } else {
      if (file.required) {
        throw new PentestError(
          `Required deliverable file not found: ${file.evidencePath} or ${file.findingsPath}`,
          'filesystem',
          false,
          { deliverableFile: [file.evidencePath, file.findingsPath], sourceDir },
          ErrorCode.DELIVERABLE_NOT_FOUND,
        );
      }
      logger.info(`No ${file.name} deliverable found`);
    }
  }

  const finalContent = sections.join('\n\n');
  const finalReportPath = path.join(dir, 'comprehensive_security_assessment_report.md');

  try {
    await fs.ensureDir(dir);
    await fs.writeFile(finalReportPath, finalContent);
    logger.info(`Final report assembled at ${finalReportPath}`);
  } catch (error) {
    const err = error as Error;
    throw new PentestError(`Failed to write final report: ${err.message}`, 'filesystem', false, {
      finalReportPath,
      originalError: err.message,
    });
  }

  return finalContent;
}

/**
 * Inject model information into the final security report.
 * Reads session.json to get the model(s) used, then injects a "Model:" line
 * into the Executive Summary section of the report.
 */
export async function injectModelIntoReport(
  repoPath: string,
  deliverablesSubdir: string | undefined,
  outputPath: string,
  logger: ActivityLogger,
): Promise<void> {
  // 1. Read session.json to get model information
  const sessionJsonPath = path.join(outputPath, 'session.json');

  if (!(await fs.pathExists(sessionJsonPath))) {
    logger.warn('session.json not found, skipping model injection');
    return;
  }

  interface SessionData {
    metrics: {
      agents: Record<string, { model?: string }>;
    };
  }

  const sessionData: SessionData = await fs.readJson(sessionJsonPath);

  // 2. Extract unique models from all agents
  const models = new Set<string>();
  for (const agent of Object.values(sessionData.metrics.agents)) {
    if (agent.model) {
      models.add(agent.model);
    }
  }

  if (models.size === 0) {
    logger.warn('No model information found in session.json');
    return;
  }

  const modelStr = Array.from(models).join(', ');
  logger.info(`Injecting model info into report: ${modelStr}`);

  // 3. Read the final report
  const reportPath = path.join(
    deliverablesDir(repoPath, deliverablesSubdir),
    'comprehensive_security_assessment_report.md',
  );

  if (!(await fs.pathExists(reportPath))) {
    logger.warn('Final report not found, skipping model injection');
    return;
  }

  let reportContent = await fs.readFile(reportPath, 'utf8');

  // 4. Find and inject model line after "Assessment Date" in Executive Summary
  // Pattern: "- Assessment Date: <date>" followed by a newline
  const assessmentDatePattern = /^(- Assessment Date: .+)$/m;
  const match = reportContent.match(assessmentDatePattern);

  if (match) {
    // Inject model line after Assessment Date
    const modelLine = `- Model: ${modelStr}`;
    reportContent = reportContent.replace(assessmentDatePattern, `$1\n${modelLine}`);
    logger.info('Model info injected into Executive Summary');
  } else {
    // If no Assessment Date line found, try to add after Executive Summary header
    const execSummaryPattern = /^## Executive Summary$/m;
    if (reportContent.match(execSummaryPattern)) {
      // Add model as first item in Executive Summary
      reportContent = reportContent.replace(execSummaryPattern, `## Executive Summary\n- Model: ${modelStr}`);
      logger.info('Model info added to Executive Summary header');
    } else {
      logger.warn('Could not find Executive Summary section');
      return;
    }
  }

  // 5. Write modified report back
  await fs.writeFile(reportPath, reportContent);
}
