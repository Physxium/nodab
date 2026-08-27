CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  host_token TEXT NOT NULL,
  queue_type INTEGER NOT NULL,
  members_json TEXT NOT NULL,

  culprit_voting INTEGER NOT NULL DEFAULT 1,
  exile_enabled INTEGER NOT NULL DEFAULT 0,
  today_enabled INTEGER NOT NULL DEFAULT 0,

  state TEXT NOT NULL DEFAULT 'WAITING',
  round INTEGER NOT NULL DEFAULT 1,

  positions_json TEXT,
  result_json TEXT,

  pending_exile_member TEXT,
  pending_exile_position TEXT,

  totals_json TEXT NOT NULL DEFAULT '{}',

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);


CREATE TABLE IF NOT EXISTS participants (
  room_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  participant_token TEXT NOT NULL,

  joined_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,

  PRIMARY KEY (
    room_id,
    member_name
  ),

  UNIQUE (
    room_id,
    participant_token
  )
);


CREATE INDEX IF NOT EXISTS idx_participants_room
ON participants(room_id);


CREATE TABLE IF NOT EXISTS votes (
  room_id TEXT NOT NULL,
  round INTEGER NOT NULL,

  voter_name TEXT NOT NULL,

  primary_culprit TEXT NOT NULL,
  secondary_culprit TEXT NOT NULL,

  exile_position TEXT,

  created_at INTEGER NOT NULL,

  PRIMARY KEY (
    room_id,
    round,
    voter_name
  )
);


CREATE INDEX IF NOT EXISTS idx_votes_room_round
ON votes(room_id, round);


CREATE INDEX IF NOT EXISTS idx_rooms_updated
ON rooms(updated_at);
