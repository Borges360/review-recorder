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

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS llm_usage (
  id text PRIMARY KEY,
  at timestamptz NOT NULL,
  session_id text,
  task text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  audio_seconds double precision NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd double precision,
  tariff_version text NOT NULL,
  ok boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS llm_usage_at ON llm_usage (at);
CREATE INDEX IF NOT EXISTS llm_usage_session ON llm_usage (session_id);

CREATE TABLE IF NOT EXISTS llm_audit (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL,
  action text NOT NULL,
  changes jsonb NOT NULL
);
