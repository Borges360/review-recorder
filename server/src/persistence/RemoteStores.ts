import {
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import pg from 'pg';
import type { AppConfig, EventEnvelope, EvidenceRecord, SessionRecord, TranscriptSegmentRecord } from '../shared/types.js';
import { SCHEMA_SQL } from './schema.js';

export function objectKey(sessionId: string, kind: 'audio' | 'evidence' | 'exports', name: string): string {
  return `${sessionId}/${kind}/${name}`;
}

export function publicObjectKey(sessionId: string, kind: 'audio' | 'evidence' | 'exports', name: string): string {
  return `review-recorder/${objectKey(sessionId, kind, name)}`;
}

export class RemoteStores {
  private pool: pg.Pool | null = null;
  private s3: S3Client | null = null;
  readonly hasDatabase: boolean;
  readonly hasObjectStore: boolean;

  constructor(private readonly config: AppConfig) {
    this.hasDatabase = Boolean(config.databaseUrl);
    this.hasObjectStore = Boolean(config.s3);
  }

  async init(): Promise<void> {
    if (this.config.databaseUrl) {
      this.pool = new pg.Pool({ connectionString: this.config.databaseUrl });
      await this.pool.query(SCHEMA_SQL);
    }
    if (this.config.s3) {
      this.s3 = new S3Client({
        endpoint: this.config.s3.endpoint,
        region: this.config.s3.region,
        credentials: {
          accessKeyId: this.config.s3.accessKey,
          secretAccessKey: this.config.s3.secretKey,
        },
        forcePathStyle: true,
      });
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.config.s3.bucket }));
      } catch (error) {
        const name = (error as { name?: string }).name ?? '';
        if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') {
          console.warn(`MinIO bucket ensure failed: ${String(error)}`);
        }
      }
    }
  }

  async upsertSession(session: SessionRecord): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO sessions (
         id, name, slug, initial_url, description, status, created_at, started_at, stopped_at,
         output_dir, wall_elapsed_ms, active_elapsed_ms, diagnostic_trace, capture
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         started_at = EXCLUDED.started_at,
         stopped_at = EXCLUDED.stopped_at,
         output_dir = EXCLUDED.output_dir,
         wall_elapsed_ms = EXCLUDED.wall_elapsed_ms,
         active_elapsed_ms = EXCLUDED.active_elapsed_ms,
         capture = EXCLUDED.capture`,
      [
        session.id,
        session.name,
        session.slug,
        session.initialUrl,
        session.description,
        session.status,
        session.createdAt,
        session.startedAt,
        session.stoppedAt,
        session.outputDir,
        session.wallElapsedMs,
        session.activeElapsedMs,
        session.diagnosticTrace,
        session.capture ?? 'playwright',
      ],
    );
  }

  async mirrorEvent(event: EventEnvelope, clientId?: string): Promise<void> {
    if (!this.pool) return;
    const params = [
      event.sessionId,
      clientId ?? null,
      event.sequence,
      event.type,
      JSON.stringify(event.payload),
      event.timestamp,
      event.elapsedMs,
      event.activeElapsedMs,
    ];
    if (clientId) {
      await this.pool.query(
        `INSERT INTO events (session_id, client_id, sequence, type, payload, timestamp, elapsed_ms, active_elapsed_ms)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
         ON CONFLICT (session_id, client_id) WHERE client_id IS NOT NULL DO NOTHING`,
        params,
      );
      return;
    }
    await this.pool.query(
      `INSERT INTO events (session_id, client_id, sequence, type, payload, timestamp, elapsed_ms, active_elapsed_ms)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
      params,
    );
  }

  async mirrorTranscript(segment: TranscriptSegmentRecord): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO transcript_segments (
         id, session_id, text, started_at_ms, ended_at_ms, scope, candidate_element, association_confidence
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, scope = EXCLUDED.scope`,
      [
        segment.id,
        segment.sessionId,
        segment.text,
        segment.startedAtMs,
        segment.endedAtMs,
        segment.scope,
        segment.candidateElement ? JSON.stringify(segment.candidateElement) : null,
        segment.associationConfidence,
      ],
    );
  }

  async mirrorEvidence(evidence: EvidenceRecord): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO evidence (id, session_id, type, file, speech_segment_id, active_elapsed_ms)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET speech_segment_id = EXCLUDED.speech_segment_id, file = EXCLUDED.file`,
      [
        evidence.id,
        evidence.sessionId,
        evidence.type,
        evidence.file,
        evidence.speechSegmentId,
        evidence.activeElapsedMs,
      ],
    );
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!this.s3 || !this.config.s3) return;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.s3.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getObject(key: string): Promise<Buffer | null> {
    if (!this.s3 || !this.config.s3) return null;
    const result = await this.s3.send(
      new GetObjectCommand({ Bucket: this.config.s3.bucket, Key: key }),
    );
    const bytes = await result.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  }

  async publishExport(sessionId: string, reviewMd: string, reviewJson: string): Promise<void> {
    await this.putObject(objectKey(sessionId, 'exports', 'REVIEW.md'), Buffer.from(reviewMd), 'text/markdown');
    await this.putObject(objectKey(sessionId, 'exports', 'review.json'), Buffer.from(reviewJson), 'application/json');
  }
}
