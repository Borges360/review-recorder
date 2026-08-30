import { loadConfig } from '../shared/config.js';
import { SessionCompiler } from '../export/SessionCompiler.js';
import { SessionRepository } from '../persistence/SessionRepository.js';

const sessionId = process.argv[2];
if (!sessionId) {
  console.error('Usage: npm run compile -- <sessionId>');
  process.exit(1);
}

const config = loadConfig();
const repo = new SessionRepository(config.sessionsDir);
const session = repo.getSession(sessionId);
if (!session?.outputDir) {
  console.error('Session not found or has no output directory');
  process.exit(1);
}

const compiler = new SessionCompiler(session.outputDir, repo);
compiler.compile(sessionId).then((review) => {
  console.log(`Compiled ${review.timeline.length} timeline entries`);
  console.log(`Output: ${session.outputDir}`);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
