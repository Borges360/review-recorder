export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL,
  initial_url text,
  description text,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  stopped_at timestamptz,
  output_dir text,
  wall_elapsed_ms integer NOT NULL DEFAULT 0,
  active_elapsed_ms integer NOT NULL DEFAULT 0,
  diagnostic_trace boolean NOT NULL DEFAULT false,
  capture text
);

CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions (id),
  client_id text,
  sequence integer NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  timestamp timestamptz NOT NULL,
  elapsed_ms integer NOT NULL,
  active_elapsed_ms integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS events_session_client_id
  ON events (session_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS transcript_segments (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions (id),
  text text NOT NULL,
  started_at_ms integer NOT NULL,
  ended_at_ms integer NOT NULL,
  scope text NOT NULL,
  candidate_element jsonb,
  association_confidence text NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions (id),
  type text NOT NULL,
  file text NOT NULL,
  speech_segment_id text,
  active_elapsed_ms integer NOT NULL
);
`;
