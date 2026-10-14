import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

const dataDir = process.env.DATA_DIR ?? "./data";
mkdirSync(dataDir, { recursive: true });

export const db = new Database(`${dataDir}/app.db`);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Additive, repeatable migrations: every statement is IF NOT EXISTS, so
// running them on every boot is safe. The crit-8 `traces` table stays as it
// was, holding every trace anyone left on the old wall; nothing here drops or
// rewrites it.
db.exec(`
  CREATE TABLE IF NOT EXISTS traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    pid TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt_index INTEGER NOT NULL,
    seed INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    compose_end INTEGER NOT NULL,
    refine_end INTEGER NOT NULL,
    reveal_end INTEGER NOT NULL,
    dissolve_end INTEGER NOT NULL,
    lightning_at INTEGER NOT NULL,
    compose_closed INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    announced_phase TEXT NOT NULL DEFAULT 'compose',
    archived_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS round_players (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    mark INTEGER NOT NULL,
    palette TEXT NOT NULL,
    rerolls_used INTEGER NOT NULL DEFAULT 0,
    dew_used INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (round_id, participant_id)
  );

  CREATE TABLE IF NOT EXISTS objects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    motif TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    scale REAL NOT NULL,
    rotation REAL NOT NULL,
    flip INTEGER NOT NULL,
    ink REAL NOT NULL,
    depth INTEGER NOT NULL,
    z INTEGER NOT NULL,
    contributor INTEGER NOT NULL REFERENCES participants(id),
    custodian INTEGER NOT NULL REFERENCES participants(id),
    version INTEGER NOT NULL DEFAULT 1,
    reflect_on INTEGER,
    status TEXT NOT NULL DEFAULT 'placed',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    owner INTEGER NOT NULL REFERENCES participants(id),
    x REAL NOT NULL,
    y REAL NOT NULL,
    intent TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    answered_by INTEGER REFERENCES participants(id),
    created_at INTEGER NOT NULL
  );

  -- Invitation responses and borrow requests: both wait on someone's consent.
  CREATE TABLE IF NOT EXISTS proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    kind TEXT NOT NULL,
    invitation_id INTEGER REFERENCES invitations(id),
    object_id INTEGER REFERENCES objects(id),
    object_version INTEGER,
    proposer INTEGER NOT NULL REFERENCES participants(id),
    target INTEGER NOT NULL REFERENCES participants(id),
    motif TEXT NOT NULL,
    transform TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- Bubbles: an object offered to whoever catches it first.
  CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    object_id INTEGER NOT NULL REFERENCES objects(id),
    object_version INTEGER NOT NULL,
    offerer INTEGER NOT NULL REFERENCES participants(id),
    claimant INTEGER REFERENCES participants(id),
    status TEXT NOT NULL DEFAULT 'floating',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    lease_expires_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS dews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    x REAL NOT NULL,
    y REAL NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS actions (
    participant_id INTEGER NOT NULL,
    action_id TEXT NOT NULL,
    response TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (participant_id, action_id)
  );

  CREATE TABLE IF NOT EXISTS archives (
    round_id INTEGER PRIMARY KEY REFERENCES rounds(id),
    prompt_index INTEGER NOT NULL,
    scene TEXT NOT NULL,
    keyframes TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- The room's conversation. It spans rounds, so each message records the
  -- round (and phase) it was sent in; round_id is NULL before the first dream.
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    round_id INTEGER REFERENCES rounds(id),
    phase TEXT NOT NULL,
    mark INTEGER,
    body TEXT NOT NULL,
    object_id INTEGER,
    object_motif TEXT,
    created_at INTEGER NOT NULL
  );

  -- The AI companion's visits: at most one present per round.
  CREATE TABLE IF NOT EXISTS companions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    invited_by INTEGER NOT NULL REFERENCES participants(id),
    status TEXT NOT NULL DEFAULT 'present',
    ended_by INTEGER REFERENCES participants(id),
    created_at INTEGER NOT NULL,
    ended_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS objects_round ON objects(round_id, status);
  CREATE INDEX IF NOT EXISTS events_round ON events(round_id, id);
  CREATE INDEX IF NOT EXISTS chat_round ON chat_messages(round_id, id);
  CREATE INDEX IF NOT EXISTS chat_by ON chat_messages(participant_id, created_at);
  CREATE INDEX IF NOT EXISTS players_by ON round_players(participant_id, round_id);
  CREATE UNIQUE INDEX IF NOT EXISTS one_companion ON companions(round_id) WHERE status = 'present';
`);

// Columns added after rows already existed. Old rounds keep NULL scene sizes,
// which means the 2400×900 scroll they were painted on; old participants are
// people (agent = 0).
function addColumn(table: string, column: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}
addColumn("rounds", "scene_w", "INTEGER");
addColumn("rounds", "scene_h", "INTEGER");
addColumn("participants", "agent", "INTEGER NOT NULL DEFAULT 0");
