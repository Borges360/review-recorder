import { loadConfig } from '../shared/config.js';
import { SessionRepository } from '../persistence/SessionRepository.js';
import { recoverSessionTranscript } from '../voice/recoverTranscript.js';
import { createLlmService } from '../llm/factory.js';
import pg from 'pg';

const sessionId = process.argv[2];
const force = process.argv.includes('--force');

if (!sessionId) {
  console.error('Usage: npm run recover-transcript -- <sessionId> [--force]');
  process.exit(1);
}

const config = loadConfig();
const repo = new SessionRepository(config.sessionsDir);
const pool = config.databaseUrl ? new pg.Pool({ connectionString: config.databaseUrl }) : null;

createLlmService(config, pool)
  .then((llm) => recoverSessionTranscript(sessionId, config, repo, { force, llm }))
  .then((result) => {
    if (result.skipped) {
      console.log('Transcript already present — recompiled only.');
    } else {
      console.log(`Recovered ${result.textLength} characters from ${result.chunksProcessed} audio chunk(s).`);
    }
    console.log(`Timeline entries: ${result.timelineEntries}`);
    console.log(`Output: ${result.outputDir}`);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => void pool?.end());
