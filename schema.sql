/* =========================================================
   과일남 자유랭 DB
   ========================================================= */


/* ---------------------------------------------------------
   1. 실시간 방
   --------------------------------------------------------- */

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



/* ---------------------------------------------------------
   2. 방 내부 라운드 기록
   방이 살아있는 동안만 유지
   --------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS round_history (
  room_id TEXT NOT NULL,
  round INTEGER NOT NULL,

  queue_type INTEGER NOT NULL,

  result TEXT NOT NULL
    CHECK (result IN ('WIN', 'LOSS')),

  positions_json TEXT NOT NULL,

  culprit TEXT,

  played_at INTEGER NOT NULL,

  PRIMARY KEY (
    room_id,
    round
  )
);


CREATE INDEX IF NOT EXISTS idx_round_history_room
ON round_history(room_id);



/* ---------------------------------------------------------
   3. 영구 전적
   방장이 '오늘 전적 내보내기'를 하면 저장
   --------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS match_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  source_room_id TEXT NOT NULL,
  source_round INTEGER NOT NULL,

  queue_type INTEGER NOT NULL,

  result TEXT NOT NULL
    CHECK (result IN ('WIN', 'LOSS')),

  positions_json TEXT NOT NULL,

  played_at INTEGER NOT NULL,
  exported_at INTEGER NOT NULL,

  UNIQUE (
    source_room_id,
    source_round
  )
);


CREATE INDEX IF NOT EXISTS idx_match_history_played
ON match_history(played_at DESC);



/* ---------------------------------------------------------
   4. 실제 기존 전적 초기 데이터
   2026-08-30 / 3인큐 2판

   positions_json 형식은 항상:
   TOP / JG / MID / ADC / SUP

   배정되지 않은 포지션은 null
   --------------------------------------------------------- */


/* 1판 - 패
   MID 한결 / ADC 희호 / SUP 상범
*/

INSERT OR IGNORE INTO match_history (
  source_room_id,
  source_round,
  queue_type,
  result,
  positions_json,
  played_at,
  exported_at
)
VALUES (
  'manual-20260830',
  1,
  3,
  'LOSS',

  '{"탑":null,"정글":null,"미드":"한결","원딜":"희호","서폿":"상범"}',

  1788051600000,
  1788051600000
);


/* 2판 - 승
   TOP 한결 / JG 상범 / SUP 희호
*/

INSERT OR IGNORE INTO match_history (
  source_room_id,
  source_round,
  queue_type,
  result,
  positions_json,
  played_at,
  exported_at
)
VALUES (
  'manual-20260830',
  2,
  3,
  'WIN',

  '{"탑":"한결","정글":"상범","미드":null,"원딜":null,"서폿":"희호"}',

  1788055200000,
  1788055200000
);