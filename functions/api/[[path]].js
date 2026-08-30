const POSITIONS = [
  "탑",
  "정글",
  "미드",
  "원딜",
  "서폿"
];

const ROOM_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

const ROOM_TTL_MS =
  24 * 60 * 60 * 1000;

const ONLINE_MS =
  20 * 1000;


/* =========================================================
   ROUTER
   ========================================================= */

export async function onRequest(context) {
  try {
    if (!context.env.DB) {
      return json(
        {
          error:
            "D1 바인딩(DB)이 연결되지 않았습니다."
        },
        500
      );
    }

    const url =
      new URL(context.request.url);

    const parts =
      url.pathname
        .split("/")
        .filter(Boolean);

    const action =
      parts[1] || "";

    const method =
      context.request.method;


    if (method === "OPTIONS") {
      return new Response(
        null,
        { status: 204 }
      );
    }


    if (
      action === "create" &&
      method === "POST"
    ) {
      return createRoom(context);
    }

    if (
      action === "state" &&
      method === "GET"
    ) {
      return getState(context);
    }

    if (
      action === "join" &&
      method === "POST"
    ) {
      return joinRoom(context);
    }

    if (
      action === "heartbeat" &&
      method === "POST"
    ) {
      return heartbeat(context);
    }

    if (
      action === "host" &&
      method === "POST"
    ) {
      return hostAction(context);
    }

    if (
      action === "vote" &&
      method === "POST"
    ) {
      return vote(context);
    }

    if (
      action === "history" &&
      method === "GET"
    ) {
      return getMatchHistory(context);
    }


    return json(
      { error: "Not found" },
      404
    );
  } catch (error) {
    console.error(error);

    return json(
      {
        error:
          "서버 오류가 발생했습니다."
      },
      500
    );
  }
}


/* =========================================================
   방 생성
   ========================================================= */

async function createRoom({
  request,
  env
}) {
  const body =
    await request.json();

  const queueType =
    Number(body.queueType);

  const members =
    Array.isArray(body.members)
      ? body.members
        .map(
          value =>
            String(value).trim()
        )
        .filter(Boolean)
      : [];

  const unique =
    [...new Set(members)];


  if (
    ![3, 5].includes(queueType) ||
    unique.length !== queueType
  ) {
    return json(
      {
        error:
          "멤버 수를 확인해 주세요."
      },
      400
    );
  }


  const culpritVoting =
    !!body.culpritVoting;

  const exile =
    culpritVoting &&
    !!body.exile;

  const todayCulprit =
    culpritVoting &&
    !!body.todayCulprit;

  const now =
    Date.now();


  await cleanupExpired(
    env.DB,
    now
  );


  let roomId = null;

  for (
    let i = 0;
    i < 5;
    i++
  ) {
    const candidate =
      randomId(10);

    const exists =
      await env.DB
        .prepare(
          `
          SELECT 1
          FROM rooms
          WHERE id = ?
          `
        )
        .bind(candidate)
        .first();

    if (!exists) {
      roomId =
        candidate;

      break;
    }
  }


  if (!roomId) {
    return json(
      {
        error:
          "방 번호 생성에 실패했습니다."
      },
      500
    );
  }


  const hostToken =
    randomSecret();

  const totals =
    Object.fromEntries(
      unique.map(
        name => [
          name,
          0
        ]
      )
    );


  await env.DB
    .prepare(
      `
      INSERT INTO rooms (
        id,
        host_token,
        queue_type,
        members_json,

        culprit_voting,
        exile_enabled,
        today_enabled,

        state,
        round,

        positions_json,
        result_json,

        pending_exile_member,
        pending_exile_position,

        totals_json,

        created_at,
        updated_at
      )

      VALUES (
        ?, ?, ?, ?,
        ?, ?, ?,
        'WAITING',
        1,
        NULL,
        NULL,
        NULL,
        NULL,
        ?,
        ?, ?
      )
      `
    )
    .bind(
      roomId,
      hostToken,
      queueType,
      JSON.stringify(unique),

      culpritVoting ? 1 : 0,
      exile ? 1 : 0,
      todayCulprit ? 1 : 0,

      JSON.stringify(totals),

      now,
      now
    )
    .run();


  return json({
    roomId,
    hostToken
  });
}


/* =========================================================
   방 상태
   ========================================================= */

async function getState({
  request,
  env
}) {
  const url =
    new URL(request.url);

  const roomId =
    url.searchParams.get("r") || "";

  const participantToken =
    url.searchParams.get("pt") || "";


  const room =
    await getRoom(
      env.DB,
      roomId
    );


  if (!room) {
    return json(
      {
        error:
          "존재하지 않거나 만료된 방입니다."
      },
      404
    );
  }


  const now =
    Date.now();


  if (
    now -
    Number(room.updated_at) >
    ROOM_TTL_MS
  ) {
    await deleteRoom(
      env.DB,
      roomId
    );

    return json(
      {
        error:
          "이 방은 만료되었습니다."
      },
      410
    );
  }


  const participantRows =
    await env.DB
      .prepare(
        `
        SELECT
          member_name,
          participant_token,
          last_seen

        FROM participants

        WHERE room_id = ?
        `
      )
      .bind(roomId)
      .all();


  const participants =
    (
      participantRows.results ||
      []
    ).map(
      row => ({
        member:
          row.member_name,

        online:
          now -
          Number(row.last_seen) <=
          ONLINE_MS,

        mine:
          !!participantToken &&
          row.participant_token ===
          participantToken
      })
    );


  const onlineCount =
    participants.filter(
      participant =>
        participant.online
    ).length;


  let voteCount = 0;
  let myVoteSubmitted = false;


  if (
    room.state === "VOTING"
  ) {
    const count =
      await env.DB
        .prepare(
          `
          SELECT
            COUNT(*) AS count

          FROM votes

          WHERE room_id = ?
            AND round = ?
          `
        )
        .bind(
          roomId,
          room.round
        )
        .first();


    voteCount =
      Number(
        count?.count || 0
      );


    if (participantToken) {
      const me =
        (
          participantRows.results ||
          []
        ).find(
          row =>
            row.participant_token ===
            participantToken
        );


      if (me) {
        const existingVote =
          await env.DB
            .prepare(
              `
              SELECT 1

              FROM votes

              WHERE room_id = ?
                AND round = ?
                AND voter_name = ?
              `
            )
            .bind(
              roomId,
              room.round,
              me.member_name
            )
            .first();


        myVoteSubmitted =
          !!existingVote;
      }
    }
  }


  const members =
    JSON.parse(
      room.members_json
    );


  const totals =
    JSON.parse(
      room.totals_json ||
      "{}"
    );


  const todayRanking =
    members
      .map(
        member => ({
          member,

          score:
            Number(
              totals[member] ||
              0
            )
        })
      )
      .sort(
        (a, b) =>
          b.score -
          a.score ||
          a.member.localeCompare(
            b.member,
            "ko"
          )
      );


  const historyRows =
    await env.DB
      .prepare(
        `
        SELECT
          rh.round,
          rh.queue_type,
          rh.result,
          rh.positions_json,
          rh.culprit,
          rh.played_at,

          CASE
            WHEN mh.id IS NULL
            THEN 0
            ELSE 1
          END AS exported

        FROM round_history rh

        LEFT JOIN match_history mh
          ON mh.source_room_id =
             rh.room_id
         AND mh.source_round =
             rh.round

        WHERE rh.room_id = ?

        ORDER BY rh.round DESC
        `
      )
      .bind(roomId)
      .all();


  const roundHistory =
    (
      historyRows.results ||
      []
    ).map(
      row => ({
        round:
          row.round,

        queueType:
          row.queue_type,

        result:
          row.result,

        positions:
          JSON.parse(
            row.positions_json
          ),

        culprit:
          row.culprit,

        playedAt:
          row.played_at,

        exported:
          !!row.exported
      })
    );


  const exportableCount =
    roundHistory.filter(
      row =>
        !row.exported
    ).length;


  return json({
    id:
      room.id,

    queueType:
      room.queue_type,

    members,

    options: {
      culpritVoting:
        !!room.culprit_voting,

      exile:
        !!room.exile_enabled,

      todayCulprit:
        !!room.today_enabled
    },

    state:
      room.state,

    round:
      room.round,

    positions:
      room.positions_json
        ? JSON.parse(
          room.positions_json
        )
        : null,

    result:
      room.state === "RESULT" &&
        room.result_json
        ? JSON.parse(
          room.result_json
        )
        : null,

    participants,
    onlineCount,

    voteCount,
    myVoteSubmitted,

    todayRanking:
      room.today_enabled
        ? todayRanking
        : [],

    roundHistory,
    exportableCount
  });
}


/* =========================================================
   참가
   ========================================================= */

async function joinRoom({
  request,
  env
}) {
  const {
    roomId,
    member,
    participantToken
  } =
    await request.json();


  if (
    !roomId ||
    !member ||
    !participantToken
  ) {
    return json(
      {
        error:
          "입장 정보가 부족합니다."
      },
      400
    );
  }


  const room =
    await getActiveRoom(
      env.DB,
      roomId
    );


  if (!room) {
    return json(
      {
        error:
          "존재하지 않거나 만료된 방입니다."
      },
      404
    );
  }


  const members =
    JSON.parse(
      room.members_json
    );


  if (
    !members.includes(member)
  ) {
    return json(
      {
        error:
          "이 방의 멤버가 아닙니다."
      },
      400
    );
  }


  const now =
    Date.now();


  const existingByToken =
    await env.DB
      .prepare(
        `
        SELECT member_name

        FROM participants

        WHERE room_id = ?
          AND participant_token = ?
        `
      )
      .bind(
        roomId,
        participantToken
      )
      .first();


  if (
    existingByToken &&
    existingByToken.member_name !==
    member
  ) {
    await env.DB
      .prepare(
        `
        DELETE FROM participants

        WHERE room_id = ?
          AND participant_token = ?
        `
      )
      .bind(
        roomId,
        participantToken
      )
      .run();
  }


  const claimed =
    await env.DB
      .prepare(
        `
        SELECT
          participant_token

        FROM participants

        WHERE room_id = ?
          AND member_name = ?
        `
      )
      .bind(
        roomId,
        member
      )
      .first();


  if (
    claimed &&
    claimed.participant_token !==
    participantToken
  ) {
    return json(
      {
        error:
          "이미 다른 참가자가 선택한 이름입니다."
      },
      409
    );
  }


  await env.DB
    .prepare(
      `
      INSERT INTO participants (
        room_id,
        member_name,
        participant_token,
        joined_at,
        last_seen
      )

      VALUES (?, ?, ?, ?, ?)

      ON CONFLICT(
        room_id,
        member_name
      )

      DO UPDATE SET
        participant_token =
          excluded.participant_token,

        last_seen =
          excluded.last_seen
      `
    )
    .bind(
      roomId,
      member,
      participantToken,
      now,
      now
    )
    .run();


  await touchRoom(
    env.DB,
    roomId,
    now
  );


  return json({
    participantToken
  });
}


/* =========================================================
   접속 상태
   ========================================================= */

async function heartbeat({
  request,
  env
}) {
  const {
    roomId,
    participantToken
  } =
    await request.json();


  if (
    !roomId ||
    !participantToken
  ) {
    return json(
      {
        error:
          "잘못된 요청입니다."
      },
      400
    );
  }


  const now =
    Date.now();


  await env.DB
    .prepare(
      `
      UPDATE participants

      SET last_seen = ?

      WHERE room_id = ?
        AND participant_token = ?
      `
    )
    .bind(
      now,
      roomId,
      participantToken
    )
    .run();


  return json({
    ok: true
  });
}


/* =========================================================
   방장 동작
   ========================================================= */

async function hostAction({
  request,
  env
}) {
  const {
    roomId,
    hostToken,
    action
  } =
    await request.json();


  const room =
    await getActiveRoom(
      env.DB,
      roomId
    );


  if (!room) {
    return json(
      {
        error:
          "존재하지 않거나 만료된 방입니다."
      },
      404
    );
  }


  if (
    !hostToken ||
    hostToken !==
    room.host_token
  ) {
    return json(
      {
        error:
          "방장 권한이 없습니다."
      },
      403
    );
  }


  const now =
    Date.now();

  const members =
    JSON.parse(
      room.members_json
    );


  /* -------------------------------------------------------
     포지션 돌리기
     ------------------------------------------------------- */

  if (
    action === "roll"
  ) {
    if (
      room.state !==
      "WAITING"
    ) {
      return json(
        {
          error:
            "지금은 포지션을 돌릴 수 없습니다."
        },
        409
      );
    }


    const participantRows =
      await env.DB
        .prepare(
          `
          SELECT
            member_name,
            last_seen

          FROM participants

          WHERE room_id = ?
          `
        )
        .bind(roomId)
        .all();


    const online =
      new Set(
        (
          participantRows.results ||
          []
        )
          .filter(
            row =>
              now -
              Number(
                row.last_seen
              ) <=
              ONLINE_MS
          )
          .map(
            row =>
              row.member_name
          )
      );


    if (
      !members.every(
        name =>
          online.has(name)
      )
    ) {
      return json(
        {
          error:
            "전원이 입장해야 합니다."
        },
        409
      );
    }


    const positions =
      makePositions(
        room.queue_type,
        members,
        room.pending_exile_member,
        room.pending_exile_position
      );


    await env.DB
      .prepare(
        `
        UPDATE rooms

        SET
          state = 'PLAYING',
          positions_json = ?,
          result_json = NULL,

          pending_exile_member = NULL,
          pending_exile_position = NULL,

          updated_at = ?

        WHERE id = ?
        `
      )
      .bind(
        JSON.stringify(
          positions
        ),
        now,
        roomId
      )
      .run();


    return json({
      ok: true
    });
  }


  /* -------------------------------------------------------
     승리
     ------------------------------------------------------- */

  if (
    action === "win"
  ) {
    if (
      room.state !==
      "PLAYING"
    ) {
      return json(
        {
          error:
            "게임 진행 중일 때만 선택할 수 있습니다."
        },
        409
      );
    }


    await saveRoundHistory(
      env.DB,
      room,
      "WIN",
      null,
      now
    );


    await advanceRound(
      env.DB,
      roomId,
      now,
      true
    );


    return json({
      ok: true
    });
  }


  /* -------------------------------------------------------
     패배
     ------------------------------------------------------- */

  if (
    action === "loss"
  ) {
    if (
      room.state !==
      "PLAYING"
    ) {
      return json(
        {
          error:
            "게임 진행 중일 때만 선택할 수 있습니다."
        },
        409
      );
    }


    /*
     * 범인 투표 OFF:
     * 패배 기록만 저장하고 바로 다음 판
     */

    if (
      !room.culprit_voting
    ) {
      await saveRoundHistory(
        env.DB,
        room,
        "LOSS",
        null,
        now
      );


      await advanceRound(
        env.DB,
        roomId,
        now,
        true
      );


      return json({
        ok: true
      });
    }


    /*
     * 범인 투표 ON:
     * 패배 기록 생성 후 투표 단계
     */

    await saveRoundHistory(
      env.DB,
      room,
      "LOSS",
      null,
      now
    );


    await env.DB
      .prepare(
        `
        DELETE FROM votes

        WHERE room_id = ?
          AND round = ?
        `
      )
      .bind(
        roomId,
        room.round
      )
      .run();


    await env.DB
      .prepare(
        `
        UPDATE rooms

        SET
          state = 'VOTING',
          updated_at = ?

        WHERE id = ?
        `
      )
      .bind(
        now,
        roomId
      )
      .run();


    return json({
      ok: true
    });
  }


  /* -------------------------------------------------------
     다음 판
     RESULT → WAITING

     단순 모드에서는 승/패 입력 순간 이미 다음 라운드로 넘어감.
     ------------------------------------------------------- */

  if (
    action === "next"
  ) {
    if (
      room.state !==
      "RESULT"
    ) {
      return json(
        {
          error:
            "결과 공개 후 다음 판으로 갈 수 있습니다."
        },
        409
      );
    }


    await advanceRound(
      env.DB,
      roomId,
      now,
      false
    );


    return json({
      ok: true
    });
  }


  /* -------------------------------------------------------
     오늘 전적 내보내기
     ------------------------------------------------------- */

  if (
    action === "export"
  ) {
    const before =
      await env.DB
        .prepare(
          `
          SELECT
            COUNT(*) AS count

          FROM match_history

          WHERE source_room_id = ?
          `
        )
        .bind(roomId)
        .first();


    await env.DB
      .prepare(
        `
        INSERT OR IGNORE
        INTO match_history (
          source_room_id,
          source_round,
          queue_type,
          result,
          positions_json,
          played_at,
          exported_at
        )

        SELECT
          room_id,
          round,
          queue_type,
          result,
          positions_json,
          played_at,
          ?

        FROM round_history

        WHERE room_id = ?
        `
      )
      .bind(
        now,
        roomId
      )
      .run();


    const after =
      await env.DB
        .prepare(
          `
          SELECT
            COUNT(*) AS count

          FROM match_history

          WHERE source_room_id = ?
          `
        )
        .bind(roomId)
        .first();


    const exported =
      Number(
        after?.count || 0
      ) -
      Number(
        before?.count || 0
      );


    return json({
      ok: true,
      exported
    });
  }


  return json(
    {
      error:
        "알 수 없는 동작입니다."
    },
    400
  );
}


/* =========================================================
   범인 투표
   ========================================================= */

async function vote({
  request,
  env
}) {
  const body =
    await request.json();


  const room =
    await getActiveRoom(
      env.DB,
      body.roomId
    );


  if (!room) {
    return json(
      {
        error:
          "존재하지 않거나 만료된 방입니다."
      },
      404
    );
  }


  if (
    !room.culprit_voting ||
    room.state !==
    "VOTING"
  ) {
    return json(
      {
        error:
          "지금은 투표할 수 없습니다."
      },
      409
    );
  }


  const participant =
    await env.DB
      .prepare(
        `
        SELECT member_name

        FROM participants

        WHERE room_id = ?
          AND participant_token = ?
        `
      )
      .bind(
        body.roomId,
        body.participantToken ||
        ""
      )
      .first();


  if (!participant) {
    return json(
      {
        error:
          "참가자로 입장해 주세요."
      },
      403
    );
  }


  const members =
    JSON.parse(
      room.members_json
    );


  if (
    !members.includes(
      body.primary
    ) ||
    !members.includes(
      body.secondary
    ) ||
    body.primary ===
    body.secondary
  ) {
    return json(
      {
        error:
          "주 범인과 부 범인을 올바르게 선택해 주세요."
      },
      400
    );
  }


  if (
    room.exile_enabled &&
    !POSITIONS.includes(
      body.exilePosition
    )
  ) {
    return json(
      {
        error:
          "유배 포지션을 선택해 주세요."
      },
      400
    );
  }


  const now =
    Date.now();


  try {
    await env.DB
      .prepare(
        `
        INSERT INTO votes (
          room_id,
          round,
          voter_name,
          primary_culprit,
          secondary_culprit,
          exile_position,
          created_at
        )

        VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .bind(
        body.roomId,
        room.round,

        participant.member_name,

        body.primary,
        body.secondary,

        room.exile_enabled
          ? body.exilePosition
          : null,

        now
      )
      .run();
  } catch {
    return json(
      {
        error:
          "이미 이번 판에 투표했습니다."
      },
      409
    );
  }


  await touchRoom(
    env.DB,
    body.roomId,
    now
  );


  const count =
    await env.DB
      .prepare(
        `
        SELECT
          COUNT(*) AS count

        FROM votes

        WHERE room_id = ?
          AND round = ?
        `
      )
      .bind(
        body.roomId,
        room.round
      )
      .first();


  if (
    Number(
      count?.count || 0
    ) >=
    members.length
  ) {
    await finalizeVote(
      env.DB,
      room,
      members,
      now
    );
  }


  return json({
    ok: true
  });
}


/* =========================================================
   투표 집계
   ========================================================= */

async function finalizeVote(
  db,
  room,
  members,
  now
) {
  const rows =
    await db
      .prepare(
        `
        SELECT
          primary_culprit,
          secondary_culprit,
          exile_position

        FROM votes

        WHERE room_id = ?
          AND round = ?
        `
      )
      .bind(
        room.id,
        room.round
      )
      .all();


  const scores =
    Object.fromEntries(
      members.map(
        member => [
          member,
          0
        ]
      )
    );


  const primaryCount =
    Object.fromEntries(
      members.map(
        member => [
          member,
          0
        ]
      )
    );


  const exileCount =
    Object.fromEntries(
      POSITIONS.map(
        position => [
          position,
          0
        ]
      )
    );


  for (
    const row of
    rows.results || []
  ) {
    scores[
      row.primary_culprit
    ] += 10;

    scores[
      row.secondary_culprit
    ] += 5;

    primaryCount[
      row.primary_culprit
    ] += 1;


    if (
      room.exile_enabled &&
      row.exile_position
    ) {
      exileCount[
        row.exile_position
      ] += 1;
    }
  }


  const maxScore =
    Math.max(
      ...Object.values(
        scores
      )
    );


  let candidates =
    members.filter(
      member =>
        scores[member] ===
        maxScore
    );


  if (
    candidates.length > 1
  ) {
    const maxPrimary =
      Math.max(
        ...candidates.map(
          member =>
            primaryCount[
            member
            ]
        )
      );


    candidates =
      candidates.filter(
        member =>
          primaryCount[
          member
          ] ===
          maxPrimary
      );
  }


  const culprit =
    candidates[
    Math.floor(
      Math.random() *
      candidates.length
    )
    ];


  let exilePosition =
    null;


  if (
    room.exile_enabled
  ) {
    const maxExile =
      Math.max(
        ...Object.values(
          exileCount
        )
      );


    const exileCandidates =
      POSITIONS.filter(
        position =>
          exileCount[
          position
          ] ===
          maxExile
      );


    exilePosition =
      exileCandidates[
      Math.floor(
        Math.random() *
        exileCandidates.length
      )
      ];
  }


  const totals =
    JSON.parse(
      room.totals_json ||
      "{}"
    );


  for (
    const member of members
  ) {
    totals[member] =
      Number(
        totals[member] ||
        0
      ) +
      scores[member];
  }


  const scoreRows =
    members
      .map(
        member => ({
          member,

          score:
            scores[member],

          primaryVotes:
            primaryCount[
            member
            ]
        })
      )
      .sort(
        (a, b) =>
          b.score -
          a.score ||
          b.primaryVotes -
          a.primaryVotes ||
          a.member.localeCompare(
            b.member,
            "ko"
          )
      );


  const result = {
    culprit,
    exilePosition,
    scores:
      scoreRows
  };


  /*
   * 패배 기록에 최종 범인 추가
   */

  await db
    .prepare(
      `
      UPDATE round_history

      SET culprit = ?

      WHERE room_id = ?
        AND round = ?
      `
    )
    .bind(
      culprit,
      room.id,
      room.round
    )
    .run();


  await db
    .prepare(
      `
      UPDATE rooms

      SET
        state = 'RESULT',
        result_json = ?,
        totals_json = ?,

        pending_exile_member = ?,
        pending_exile_position = ?,

        updated_at = ?

      WHERE id = ?
      `
    )
    .bind(
      JSON.stringify(
        result
      ),

      JSON.stringify(
        totals
      ),

      room.exile_enabled
        ? culprit
        : null,

      room.exile_enabled
        ? exilePosition
        : null,

      now,
      room.id
    )
    .run();
}


/* =========================================================
   라운드 기록 저장
   ========================================================= */

async function saveRoundHistory(
  db,
  room,
  result,
  culprit,
  playedAt
) {
  if (!room.positions_json) {
    return;
  }


  const positions =
    JSON.parse(
      room.positions_json
    );


  const normalized =
    normalizePositions(
      positions
    );


  await db
    .prepare(
      `
      INSERT OR REPLACE
      INTO round_history (
        room_id,
        round,
        queue_type,
        result,
        positions_json,
        culprit,
        played_at
      )

      VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      room.id,
      room.round,
      room.queue_type,
      result,

      JSON.stringify(
        normalized
      ),

      culprit,
      playedAt
    )
    .run();
}


/* =========================================================
   최근 영구 전적
   ========================================================= */

async function getMatchHistory({
  request,
  env
}) {
  const url =
    new URL(request.url);


  const requestedLimit =
    Number(
      url.searchParams.get(
        "limit"
      ) || 5
    );


  const requestedOffset =
    Number(
      url.searchParams.get(
        "offset"
      ) || 0
    );


  const limit =
    Math.min(
      Math.max(
        requestedLimit,
        1
      ),
      50
    );


  const offset =
    Math.max(
      requestedOffset,
      0
    );


  const rows =
    await env.DB
      .prepare(
        `
        SELECT
          id,
          queue_type,
          result,
          positions_json,
          played_at

        FROM match_history

        ORDER BY
          played_at DESC,
          id DESC

        LIMIT ?
        OFFSET ?
        `
      )
      .bind(
        limit + 1,
        offset
      )
      .all();


  const allRows =
    rows.results || [];


  const hasMore =
    allRows.length >
    limit;


  const visibleRows =
    allRows.slice(
      0,
      limit
    );


  return json({
    matches:
      visibleRows.map(
        row => ({
          id:
            row.id,

          queueType:
            row.queue_type,

          result:
            row.result,

          positions:
            JSON.parse(
              row.positions_json
            ),

          playedAt:
            row.played_at
        })
      ),

    hasMore,

    nextOffset:
      offset +
      visibleRows.length
  });
}


/* =========================================================
   포지션 생성
   ========================================================= */

function makePositions(
  queueType,
  members,
  exileMember,
  exilePosition
) {
  /*
   * 5인큐
   */

  if (
    Number(queueType) === 5
  ) {
    const assignments = [];

    const remainingMembers =
      [...members];

    const remainingPositions =
      [...POSITIONS];


    if (
      exileMember &&
      exilePosition &&
      remainingMembers.includes(
        exileMember
      ) &&
      remainingPositions.includes(
        exilePosition
      )
    ) {
      assignments.push({
        player:
          exileMember,

        position:
          exilePosition
      });


      remainingMembers.splice(
        remainingMembers.indexOf(
          exileMember
        ),
        1
      );


      remainingPositions.splice(
        remainingPositions.indexOf(
          exilePosition
        ),
        1
      );
    }


    shuffle(
      remainingMembers
    );

    shuffle(
      remainingPositions
    );


    remainingMembers.forEach(
      (player, index) => {
        assignments.push({
          player,

          position:
            remainingPositions[
            index
            ]
        });
      }
    );


    return POSITIONS.map(
      position =>
        assignments.find(
          assignment =>
            assignment.position ===
            position
        )
    );
  }


  /*
   * 3인큐
   *
   * 주 포지션만 3개 배정.
   * 부 포지션은 더 이상 생성하지 않음.
   */


  const primaryMap = {};

  const availablePositions =
    [...POSITIONS];


  if (
    exileMember &&
    exilePosition &&
    members.includes(
      exileMember
    ) &&
    availablePositions.includes(
      exilePosition
    )
  ) {
    primaryMap[
      exileMember
    ] =
      exilePosition;


    availablePositions.splice(
      availablePositions.indexOf(
        exilePosition
      ),
      1
    );
  }


  const remainingMembers =
    members.filter(
      member =>
        !primaryMap[member]
    );


  shuffle(
    availablePositions
  );


  remainingMembers.forEach(
    (member, index) => {
      primaryMap[member] =
        availablePositions[
        index
        ];
    }
  );


  return members.map(
    player => ({
      player,

      primary:
        primaryMap[player]
    })
  );
}


/* =========================================================
   전적용 포지션 표준화
   항상 TOP/JG/MID/ADC/SUP 5자리
   ========================================================= */

function normalizePositions(
  positions
) {
  const result = {
    "탑": null,
    "정글": null,
    "미드": null,
    "원딜": null,
    "서폿": null
  };


  for (
    const row of
    positions || []
  ) {
    /*
     * 5인큐
     */

    if (
      row.position &&
      POSITIONS.includes(
        row.position
      )
    ) {
      result[
        row.position
      ] =
        row.player;

      continue;
    }


    /*
     * 3인큐
     */

    if (
      row.primary &&
      POSITIONS.includes(
        row.primary
      )
    ) {
      result[
        row.primary
      ] =
        row.player;
    }
  }


  return result;
}


/* =========================================================
   다음 라운드
   ========================================================= */

async function advanceRound(
  db,
  roomId,
  now,
  clearExile
) {
  if (clearExile) {
    await db
      .prepare(
        `
        UPDATE rooms

        SET
          state = 'WAITING',
          round = round + 1,
          positions_json = NULL,
          result_json = NULL,

          pending_exile_member = NULL,
          pending_exile_position = NULL,

          updated_at = ?

        WHERE id = ?
        `
      )
      .bind(
        now,
        roomId
      )
      .run();

    return;
  }


  /*
   * 패배 투표 후 다음 판:
   * 유배 정보를 유지해야 한다.
   */

  await db
    .prepare(
      `
      UPDATE rooms

      SET
        state = 'WAITING',
        round = round + 1,
        positions_json = NULL,
        result_json = NULL,

        updated_at = ?

      WHERE id = ?
      `
    )
    .bind(
      now,
      roomId
    )
    .run();
}


/* =========================================================
   공통 DB
   ========================================================= */

async function getRoom(
  db,
  id
) {
  if (!id) {
    return null;
  }


  return db
    .prepare(
      `
      SELECT *

      FROM rooms

      WHERE id = ?
      `
    )
    .bind(id)
    .first();
}


async function getActiveRoom(
  db,
  id
) {
  const room =
    await getRoom(
      db,
      id
    );


  if (!room) {
    return null;
  }


  if (
    Date.now() -
    Number(
      room.updated_at
    ) >
    ROOM_TTL_MS
  ) {
    await deleteRoom(
      db,
      id
    );

    return null;
  }


  return room;
}


async function touchRoom(
  db,
  id,
  now = Date.now()
) {
  await db
    .prepare(
      `
      UPDATE rooms

      SET updated_at = ?

      WHERE id = ?
      `
    )
    .bind(
      now,
      id
    )
    .run();
}


async function cleanupExpired(
  db,
  now = Date.now()
) {
  const cutoff =
    now -
    ROOM_TTL_MS;


  const expired =
    await db
      .prepare(
        `
        SELECT id

        FROM rooms

        WHERE updated_at < ?

        LIMIT 100
        `
      )
      .bind(cutoff)
      .all();


  for (
    const row of
    expired.results || []
  ) {
    await deleteRoom(
      db,
      row.id
    );
  }
}


/* =========================================================
   방 삭제
   영구 match_history는 삭제하지 않음
   ========================================================= */

async function deleteRoom(
  db,
  id
) {
  await db.batch([
    db
      .prepare(
        `
        DELETE FROM votes
        WHERE room_id = ?
        `
      )
      .bind(id),

    db
      .prepare(
        `
        DELETE FROM participants
        WHERE room_id = ?
        `
      )
      .bind(id),

    db
      .prepare(
        `
        DELETE FROM round_history
        WHERE room_id = ?
        `
      )
      .bind(id),

    db
      .prepare(
        `
        DELETE FROM rooms
        WHERE id = ?
        `
      )
      .bind(id)
  ]);
}


/* =========================================================
   Random
   ========================================================= */

function shuffle(array) {
  for (
    let i =
      array.length - 1;

    i > 0;

    i--
  ) {
    const j =
      Math.floor(
        Math.random() *
        (i + 1)
      );


    [
      array[i],
      array[j]
    ] = [
        array[j],
        array[i]
      ];
  }


  return array;
}


function randomId(length) {
  const bytes =
    new Uint8Array(length);


  crypto.getRandomValues(
    bytes
  );


  let result = "";


  for (
    const byte of bytes
  ) {
    result +=
      ROOM_ALPHABET[
      byte %
      ROOM_ALPHABET.length
      ];
  }


  return result;
}


function randomSecret() {
  const bytes =
    new Uint8Array(24);


  crypto.getRandomValues(
    bytes
  );


  return Array
    .from(
      bytes,
      byte =>
        byte
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}


/* =========================================================
   Response
   ========================================================= */

function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store"
      }
    }
  );
}