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


export async function onRequest(
  context
) {
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
      new URL(
        context.request.url
      );


    const parts =
      url.pathname
        .split("/")
        .filter(Boolean);


    const action =
      parts[1] || "";


    if (
      context.request.method ===
      "OPTIONS"
    ) {
      return new Response(
        null,
        {
          status: 204
        }
      );
    }


    if (
      action === "create" &&
      context.request.method ===
      "POST"
    ) {
      return createRoom(context);
    }


    if (
      action === "state" &&
      context.request.method ===
      "GET"
    ) {
      return getState(context);
    }


    if (
      action === "join" &&
      context.request.method ===
      "POST"
    ) {
      return joinRoom(context);
    }


    if (
      action === "heartbeat" &&
      context.request.method ===
      "POST"
    ) {
      return heartbeat(context);
    }


    if (
      action === "host" &&
      context.request.method ===
      "POST"
    ) {
      return hostAction(context);
    }


    if (
      action === "vote" &&
      context.request.method ===
      "POST"
    ) {
      return vote(context);
    }


    return json(
      {
        error:
          "Not found"
      },
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


async function createRoom({
  request,
  env
}) {
  const body =
    await request.json();


  const queueType =
    Number(
      body.queueType
    );


  const members =
    Array.isArray(body.members)
      ? body.members
          .map(
            (v) =>
              String(v).trim()
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


  if (
    unique.some(
      (v) => v.length > 20
    )
  ) {
    return json(
      {
        error:
          "이름이 너무 깁니다."
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


  let roomId;


  for (
    let i = 0;
    i < 5;
    i++
  ) {
    roomId =
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
        .bind(roomId)
        .first();


    if (!exists) {
      break;
    }


    roomId = null;
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
        (name) => [
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
          ?,
          ?,
          ?,
          ?,

          ?,
          ?,
          ?,

          'WAITING',
          1,

          NULL,
          NULL,

          NULL,
          NULL,

          ?,

          ?,
          ?
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


async function getState({
  request,
  env
}) {
  const url =
    new URL(
      request.url
    );


  const roomId =
    url.searchParams.get("r") ||
    "";


  const pt =
    url.searchParams.get("pt") ||
    "";


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
      room.updated_at >
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
      (row) => ({
        member:
          row.member_name,

        online:
          now -
            Number(
              row.last_seen
            ) <=
          ONLINE_MS,

        mine:
          !!pt &&
          row.participant_token ===
            pt
      })
    );


  const onlineCount =
    participants.filter(
      (p) => p.online
    ).length;


  let voteCount = 0;

  let myVoteSubmitted =
    false;


  if (
    room.state === "VOTING"
  ) {
    const countRow =
      await env.DB
        .prepare(
          `
            SELECT
              COUNT(*) AS c

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
        countRow?.c || 0
      );


    if (pt) {
      const me =
        participantRows
          .results
          ?.find(
            (row) =>
              row.participant_token ===
              pt
          );


      if (me) {
        const v =
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
          !!v;
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
        (member) => ({
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
      room.state ===
        "RESULT" &&
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
        : []
  });
}


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
          SELECT
            member_name

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

        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?
        )

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
    hostToken !== room.host_token
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
            (row) =>
              now -
                Number(
                  row.last_seen
                ) <=
              ONLINE_MS
          )
          .map(
            (row) =>
              row.member_name
          )
      );


    if (
      !members.every(
        (name) =>
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


  if (
    action === "win"
  ) {
    if (
      !room.culprit_voting
    ) {
      return json(
        {
          error:
            "범인 투표가 꺼진 방입니다."
        },
        409
      );
    }


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


    await env.DB
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


    return json({
      ok: true
    });
  }


  if (
    action === "loss"
  ) {
    if (
      !room.culprit_voting
    ) {
      return json(
        {
          error:
            "범인 투표가 꺼진 방입니다."
        },
        409
      );
    }


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


  if (
    action === "next"
  ) {
    if (
      !room.culprit_voting
    ) {
      if (
        room.state !==
        "PLAYING"
      ) {
        return json(
          {
            error:
              "게임 진행 중일 때만 다음 판으로 갈 수 있습니다."
          },
          409
        );
      }


      await env.DB
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


      return json({
        ok: true
      });
    }


    if (
      room.state !==
      "RESULT"
    ) {
      return json(
        {
          error:
            "투표 결과 공개 후 다음 판으로 갈 수 있습니다."
        },
        409
      );
    }


    await env.DB
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


    return json({
      ok: true
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
    room.state !== "VOTING"
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
          SELECT
            member_name

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

          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
          )
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


  const countRow =
    await env.DB
      .prepare(
        `
          SELECT
            COUNT(*) AS c

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
      countRow?.c ||
      0
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
        (m) => [
          m,
          0
        ]
      )
    );


  const primaryCount =
    Object.fromEntries(
      members.map(
        (m) => [
          m,
          0
        ]
      )
    );


  const exileCount =
    Object.fromEntries(
      POSITIONS.map(
        (p) => [
          p,
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
      (m) =>
        scores[m] ===
        maxScore
    );


  if (
    candidates.length > 1
  ) {
    const maxPrimary =
      Math.max(
        ...candidates.map(
          (m) =>
            primaryCount[m]
        )
      );


    candidates =
      candidates.filter(
        (m) =>
          primaryCount[m] ===
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
        (p) =>
          exileCount[p] ===
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
        (member) => ({
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
      JSON.stringify(result),
      JSON.stringify(totals),

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


function makePositions(
  queueType,
  members,
  exileMember,
  exilePosition
) {
  if (
    queueType === 5
  ) {
    const rows = [];

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
      rows.push({
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


    for (
      let i = 0;
      i <
      remainingMembers.length;
      i++
    ) {
      rows.push({
        player:
          remainingMembers[i],

        position:
          remainingPositions[i]
      });
    }


    return POSITIONS.map(
      (position) =>
        rows.find(
          (row) =>
            row.position ===
            position
        )
    );
  }


  const players =
    [...members];


  const primaryMap = {};


  const available =
    [...POSITIONS];


  if (
    exileMember &&
    exilePosition &&
    players.includes(
      exileMember
    ) &&
    available.includes(
      exilePosition
    )
  ) {
    primaryMap[
      exileMember
    ] =
      exilePosition;


    available.splice(
      available.indexOf(
        exilePosition
      ),
      1
    );
  }


  const remainingPlayers =
    players.filter(
      (p) =>
        !primaryMap[p]
    );


  shuffle(available);


  remainingPlayers.forEach(
    (p, i) => {
      primaryMap[p] =
        available[i];
    }
  );


  return players.map(
    (player) => {
      const primary =
        primaryMap[
          player
        ];


      const secondaryPool =
        POSITIONS.filter(
          (p) =>
            p !== primary
        );


      const secondary =
        secondaryPool[
          Math.floor(
            Math.random() *
            secondaryPool.length
          )
        ];


      return {
        player,
        primary,
        secondary
      };
    }
  );
}


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


async function getRoom(
  db,
  id
) {
  if (!id) return null;


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
      room.updated_at >
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
          DELETE FROM rooms

          WHERE id = ?
        `
      )
      .bind(id)
  ]);
}


function randomId(length) {
  const bytes =
    new Uint8Array(length);


  crypto.getRandomValues(
    bytes
  );


  let out = "";


  for (
    const b of bytes
  ) {
    out +=
      ROOM_ALPHABET[
        b %
        ROOM_ALPHABET.length
      ];
  }


  return out;
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
      (b) =>
        b
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}


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
