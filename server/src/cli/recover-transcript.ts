import { loadConfig } from '../shared/config.js';
import { SessionRepository } from '../persistence/SessionRepository.js';
import { recoverSessionTranscript } from '../voice/recoverTranscript.js';

const sessionId = process.argv[2];
const force = process.argv.includes('--force');

if (!sessionId) {
  console.error('Usage: npm run recover-transcript -- <sessionId> [--force]');
  process.exit(1);
}

const config = loadConfig();
const repo = new SessionRepository(config.sessionsDir);

recoverSessionTranscript(sessionId, config, repo, { force })
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
  });
