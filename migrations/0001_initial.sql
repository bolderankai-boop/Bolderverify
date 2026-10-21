PRAGMA foreign_keys = ON;
CREATE TABLE agents (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT NOT NULL CHECK (json_valid(config)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, id)
);
CREATE TABLE evaluations (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  agent_id TEXT,
  report TEXT NOT NULL CHECK (json_valid(report)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, agent_id) REFERENCES agents(org_id, id)
);
CREATE TABLE executions (
  org_id TEXT NOT NULL,
  id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'rejected')),
  output TEXT NOT NULL CHECK (json_valid(output)),
  tool_request TEXT CHECK (tool_request IS NULL OR json_valid(tool_request)),
  tool_result TEXT CHECK (tool_result IS NULL OR json_valid(tool_result)),
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  PRIMARY KEY (org_id, id),
  FOREIGN KEY (org_id, agent_id) REFERENCES agents(org_id, id)
);
CREATE INDEX evaluation_history ON evaluations(org_id, created_at DESC);
CREATE INDEX execution_history ON executions(org_id, created_at DESC);

