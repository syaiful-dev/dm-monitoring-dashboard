#!/usr/bin/env node
/**
 * Kiro CLI integration seam — AI analysis of ETL (Pentaho) errors.
 *
 * WHAT THIS DOES
 *   Reads the ETL-errors JSON (public/data/pentaho-ai-issues.json), and for each
 *   issue asks an AI "command" to produce a root-cause explanation + concrete
 *   fix plan, then writes the enriched result back into the same JSON. The ETL
 *   Errors tab already renders whatever is in that file, so the UI needs no
 *   change — this just upgrades WHO fills the `root_cause` / `suggested_fix`
 *   fields: an AI, instead of the rule-based processor.
 *
 * HOW THE AI IS CALLED (the "seam")
 *   The AI command is pluggable via the KIRO_CMD environment variable. The app
 *   shells out to it, pipes the error context in on stdin, and reads the AI's
 *   answer from stdout. Example once Kiro CLI is installed on the host:
 *
 *     set KIRO_CMD=kiro run --prompt-file -      (Windows)
 *     export KIRO_CMD="kiro run --prompt-file -" (Linux/EC2)
 *
 *   (Use the real kiro invocation from the official Kiro CLI docs — the exact
 *   flags belong there, not guessed here.)
 *
 *   If KIRO_CMD is NOT set, this script runs in SAFE PREVIEW mode: it keeps the
 *   existing rule-based fields and just tags them, so nothing breaks and you can
 *   wire/test the pipeline before Kiro CLI exists.
 *
 * USAGE
 *   node scripts/kiro-analyze-errors.js [path-to-json]
 *   (defaults to public/data/pentaho-ai-issues.json)
 *
 * This is designed to run as a BACKGROUND / SCHEDULED job (cron on EC2, or a
 * Kiro hook), not per web request.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DATA_FILE = process.argv[2] || path.join(__dirname, '..', 'public', 'data', 'pentaho-ai-issues.json');
const KIRO_CMD = (process.env.KIRO_CMD || '').trim();
const AI_TIMEOUT_MS = parseInt(process.env.KIRO_TIMEOUT_MS, 10) || 60000;

// Build the prompt sent to the AI for one error.
function buildPrompt(issue) {
  return [
    'You are an ETL (Pentaho/PDI) support engineer. Analyze this pipeline error and respond with STRICT JSON only:',
    '{ "root_cause": "<one or two sentences>", "suggested_fix": ["step 1", "step 2", ...] }',
    '',
    'Error details:',
    `  Workflow:   ${issue.workflow || '-'}`,
    `  Step:       ${issue.failed_step || '-'}`,
    `  Exception:  ${issue.exception || '-'}`,
    `  Type:       ${issue.type || '-'}`,
    '  Raw log context:',
    (issue.raw_context || '').split('\n').map(l => '    ' + l).join('\n'),
    '',
    'Respond with JSON only, no prose.'
  ].join('\n');
}

// Call the external AI command (Kiro CLI). Returns parsed { root_cause, suggested_fix } or null.
function callAI(prompt) {
  if (!KIRO_CMD) return null; // safe preview mode — no AI configured

  // KIRO_CMD may include args, e.g. "kiro run --prompt-file -". Split naively on spaces.
  const parts = KIRO_CMD.split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  const res = spawnSync(cmd, args, {
    input: prompt,
    encoding: 'utf-8',
    timeout: AI_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024
  });

  if (res.error) {
    console.error('  AI call failed:', res.error.message);
    return null;
  }
  if (res.status !== 0) {
    console.error('  AI exited', res.status, (res.stderr || '').slice(0, 200));
    return null;
  }

  // Extract the first JSON object from stdout (the model may wrap it in text).
  const out = String(res.stdout || '');
  const match = out.match(/\{[\s\S]*\}/);
  if (!match) { console.error('  AI output had no JSON'); return null; }
  try {
    const parsed = JSON.parse(match[0]);
    if (!parsed.root_cause && !Array.isArray(parsed.suggested_fix)) return null;
    return {
      root_cause: parsed.root_cause || '',
      suggested_fix: Array.isArray(parsed.suggested_fix) ? parsed.suggested_fix : []
    };
  } catch (e) {
    console.error('  AI output was not valid JSON:', e.message);
    return null;
  }
}

function main() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error('Data file not found:', DATA_FILE);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  const issues = Array.isArray(data.issues) ? data.issues : [];
  console.log(`[kiro-analyze] ${issues.length} issue(s) in ${path.basename(DATA_FILE)}`);
  console.log(`[kiro-analyze] KIRO_CMD = ${KIRO_CMD || '(not set → safe preview mode, no AI call)'}`);

  let enriched = 0;
  issues.forEach((issue, i) => {
    console.log(`  [${i + 1}/${issues.length}] ${issue.workflow || issue.id} …`);
    const ai = callAI(buildPrompt(issue));
    if (ai) {
      if (ai.root_cause) issue.root_cause = ai.root_cause;
      if (ai.suggested_fix.length) issue.suggested_fix = ai.suggested_fix;
      issue.analysis_source = 'kiro-cli';
      enriched++;
    } else {
      // Preserve existing rule-based fields; mark their origin.
      issue.analysis_source = issue.analysis_source || 'rule-based';
    }
  });

  data.analysisUpdatedAt = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[kiro-analyze] done — ${enriched} enriched by AI, ${issues.length - enriched} kept as-is.`);
}

main();
