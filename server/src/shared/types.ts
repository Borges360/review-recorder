export type SessionStatus =
  | 'CREATED'
  | 'STARTING'
  | 'RECORDING'
  | 'PAUSED'
  | 'STOPPING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RECOVERABLE';

export type AssociationConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type ObservationScope = 'ELEMENT' | 'SCREEN';

export interface ElementIdentity {
  tag: string;
  role: string | null;
  accessibleName: string | null;
  text: string | null;
  testId: string | null;
  id: string | null;
  name: string | null;
  bounds: { x: number; y: number; width: number; height: number } | null;
}

export interface SessionRecord {
  id: string;
  name: string;
  slug: string;
  initialUrl: string | null;
  description: string | null;
  status: SessionStatus;
  createdAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
  outputDir: string | null;
  wallElapsedMs: number;
  activeElapsedMs: number;
  diagnosticTrace: boolean;
}

export interface ScreenStateRecord {
  id: string;
  sessionId: string;
  fingerprint: string;
  url: string;
  normalizedRoute: string;
  title: string;
  ariaSnapshot: string;
  dialogs: string[];
  createdAt: string;
  sequence: number;
}

export interface TranscriptSegmentRecord {
  id: string;
  sessionId: string;
  itemId: string | null;
  text: string;
  startedAtMs: number;
  endedAtMs: number;
  screenStateId: string | null;
  pageId: string | null;
  lastActionId: string | null;
  scope: ObservationScope;
  candidateElement: ElementIdentity | null;
  associationConfidence: AssociationConfidence;
}

export interface EvidenceRecord {
  id: string;
  sessionId: string;
  type: 'manual-screenshot';
  file: string;
  screenStateId: string | null;
  speechSegmentId: string | null;
  timestamp: string;
  elapsedMs: number;
  activeElapsedMs: number;
}

export interface EventEnvelope<T = Record<string, unknown>> {
  sequence: number;
  timestamp: string;
  elapsedMs: number;
  activeElapsedMs: number;
  sessionId: string;
  type: string;
  payload: T;
}

export interface TimelineEntry {
  id: string;
  offset: string;
  type: 'session' | 'screen' | 'action' | 'observation' | 'pause' | 'resume' | 'evidence';
  [key: string]: unknown;
}

export interface TimelineEntryRecord {
  id: string;
  sessionId: string;
  sequence: number;
  offset: string;
  type: TimelineEntry['type'];
  payload: string;
  createdAt: string;
}

export interface ReviewPackage {
  schemaVersion: '1.0';
  session: {
    id: string;
    name: string;
    startedAt: string;
    stoppedAt: string | null;
    activeDurationSeconds: number;
    wallDurationSeconds: number;
  };
  timeline: TimelineEntry[];
}

export interface AppConfig {
  port: number;
  uiOrigin: string;
  sessionsDir: string;
  dataDir: string;
  browserProfileDir: string;
  openaiApiKey: string | null;
  diagnosticTrace: boolean;
  useFakeTranscriber: boolean;
  mockBrowser: boolean;
  browserHeadless: boolean;
}
