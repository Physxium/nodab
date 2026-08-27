const PRESET_MEMBERS = [
  "한결",
  "창현",
  "상범",
  "현수",
  "태원",
  "동영",
  "희호",
  "이나",
  "정안",
  "의준",
  "도연",
  "정훈"
];

const POSITIONS = [
  "탑",
  "정글",
  "미드",
  "원딜",
  "서폿"
];

const POSITION_CODES = {
  탑: "TOP",
  정글: "JUNGLE",
  미드: "MID",
  원딜: "ADC",
  서폿: "SUPPORT"
};

const $ = (id) => document.getElementById(id);

const roomId =
  new URLSearchParams(location.search).get("r");

let queueSize = 5;

let selectedMembers = [];
let customMembers = [];

let currentRoom = null;

let pollTimer = null;
let heartbeatTimer = null;
let toastTimer = null;

const storageKey = (kind) =>
  `gwailnam:${roomId}:${kind}`;

const getHostToken = () =>
  roomId
    ? localStorage.getItem(storageKey("host"))
    : null;

const getParticipantToken = () =>
  roomId
    ? localStorage.getItem(storageKey("participant"))
    : null;

const getMyMember = () =>
  roomId
    ? localStorage.getItem(storageKey("member"))
    : null;


function randomToken(bytes = 18) {
  const data = new Uint8Array(bytes);

  crypto.getRandomValues(data);

  return Array
    .from(
      data,
      (b) => b.toString(16).padStart(2, "0")
    )
    .join("");
}


function showToast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 1800);
}


async function api(path, options = {}) {
  const response = await fetch(
    `/api/${path}`,
    {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    }
  );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error ||
      "요청을 처리하지 못했습니다."
    );
  }

  return data;
}


function allMembers() {
  return [
    ...PRESET_MEMBERS,
    ...customMembers
  ];
}


function renderMemberPicker() {
  $("memberGrid").innerHTML = "";

  for (const name of allMembers()) {
    const button =
      document.createElement("button");

    button.type = "button";

    button.className =
      "member-button";

    button.textContent = name;

    if (
      selectedMembers.includes(name)
    ) {
      button.classList.add("selected");
    }

    if (
      !selectedMembers.includes(name) &&
      selectedMembers.length >= queueSize
    ) {
      button.classList.add(
        "limit-disabled"
      );
    }

    button.onclick = () => {
      if (
        selectedMembers.includes(name)
      ) {
        selectedMembers =
          selectedMembers.filter(
            (v) => v !== name
          );
      } else if (
        selectedMembers.length <
        queueSize
      ) {
        selectedMembers.push(name);
      }

      renderMemberPicker();
    };

    $("memberGrid")
      .appendChild(button);
  }


  const custom =
    document.createElement("button");

  custom.type = "button";

  custom.className =
    "member-button custom-trigger";

  custom.textContent =
    "+ 직접 입력";

  custom.onclick = () => {
    $("customInputWrap").hidden =
      !$("customInputWrap").hidden;

    if (
      !$("customInputWrap").hidden
    ) {
      $("customName").focus();
    }
  };

  $("memberGrid")
    .appendChild(custom);


  $("memberCount").textContent =
    `${selectedMembers.length} / ${queueSize}`;

  const remain =
    queueSize -
    selectedMembers.length;

  $("helperText").textContent =
    remain
      ? `${remain}명 더 선택해 주세요.`
      : "준비 완료.";

  $("createRoomButton").disabled =
    remain !== 0;
}


function syncOptionState() {
  const enabled =
    $("culpritToggle").checked;

  for (
    const id of [
      "exileToggle",
      "todayToggle"
    ]
  ) {
    const input = $(id);

    input.disabled =
      !enabled;

    input
      .closest(".toggle-row")
      .classList
      .toggle(
        "disabled",
        !enabled
      );

    if (!enabled) {
      input.checked = false;
    }
  }
}


function addCustomName() {
  const name =
    $("customName")
      .value
      .trim();

  if (!name) return;

  if (
    allMembers()
      .includes(name)
  ) {
    return showToast(
      "이미 있는 이름이에요."
    );
  }

  customMembers.push(name);

  $("customName").value = "";

  $("customInputWrap").hidden = true;

  if (
    selectedMembers.length <
    queueSize
  ) {
    selectedMembers.push(name);
  }

  renderMemberPicker();
}


function openCreateConfirm() {
  const options = [
    `큐 타입: ${queueSize}인큐`,
    `멤버: ${selectedMembers.join(", ")}`,
    `범인 투표: ${
      $("culpritToggle").checked
        ? "ON"
        : "OFF"
    }`
  ];

  if (
    $("culpritToggle").checked
  ) {
    options.push(
      `범인 유배: ${
        $("exileToggle").checked
          ? "ON"
          : "OFF"
      }`
    );

    options.push(
      `오늘의 범인: ${
        $("todayToggle").checked
          ? "ON"
          : "OFF"
      }`
    );
  }

  $("confirmSummary").innerHTML =
    options
      .map(
        (v) =>
          `<div>${escapeHtml(v)}</div>`
      )
      .join("");

  $("confirmModal").hidden = false;
}


async function createRoom() {
  $("confirmCreate").disabled = true;

  try {
    const result =
      await api(
        "create",
        {
          method: "POST",

          body: JSON.stringify({
            queueType: queueSize,

            members:
              selectedMembers,

            culpritVoting:
              $("culpritToggle").checked,

            exile:
              $("culpritToggle").checked &&
              $("exileToggle").checked,

            todayCulprit:
              $("culpritToggle").checked &&
              $("todayToggle").checked
          })
        }
      );

    localStorage.setItem(
      `gwailnam:${result.roomId}:host`,
      result.hostToken
    );

    location.href =
      `${location.pathname}?r=${result.roomId}`;
  } catch (error) {
    showToast(error.message);

    $("confirmCreate").disabled =
      false;
  }
}


function escapeHtml(value) {
  return String(value ?? "")
    .replace(
      /[&<>"']/g,
      (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#039;"
      })[ch]
    );
}


function optionText(room) {
  const parts = [
    `${room.queueType}인큐`
  ];

  if (
    !room.options.culpritVoting
  ) {
    parts.push("단순 리롤");
  } else {
    parts.push("범인 투표");

    if (
      room.options.exile
    ) {
      parts.push("유배 ON");
    }

    if (
      room.options.todayCulprit
    ) {
      parts.push(
        "오늘의 범인 ON"
      );
    }
  }

  return parts.join(" · ");
}


async function loadRoom() {
  $("homeView").hidden = true;

  $("roomView").hidden = false;

  $("roomCode").textContent =
    roomId;

  await refreshRoom(true);

  startTimers();
}


function startTimers() {
  clearInterval(pollTimer);

  clearInterval(heartbeatTimer);


  pollTimer =
    setInterval(() => {
      if (
        document.visibilityState ===
        "visible"
      ) {
        refreshRoom(false);
      }
    }, 2000);


  heartbeatTimer =
    setInterval(() => {
      if (
        document.visibilityState ===
        "visible"
      ) {
        heartbeat();
      }
    }, 10000);


  document.addEventListener(
    "visibilitychange",
    () => {
      if (
        document.visibilityState ===
        "visible"
      ) {
        heartbeat();
        refreshRoom(false);
      }
    }
  );
}


async function heartbeat() {
  const token =
    getParticipantToken();

  if (!token) return;

  try {
    await api(
      "heartbeat",
      {
        method: "POST",

        body: JSON.stringify({
          roomId,
          participantToken: token
        })
      }
    );
  } catch {}
}


async function refreshRoom(
  loud = false
) {
  try {
    const token =
      getParticipantToken();

    const query =
      new URLSearchParams({
        r: roomId
      });

    if (token) {
      query.set("pt", token);
    }

    const room =
      await api(
        `state?${query.toString()}`
      );

    currentRoom = room;

    renderRoom(room);
  } catch (error) {
    if (loud) {
      showToast(error.message);
    }

    if (
      error.message.includes("만료")
    ) {
      clearInterval(pollTimer);
      clearInterval(heartbeatTimer);

      $("roomView").innerHTML =
        `
          <section class="panel">
            <div class="notice">
              ${escapeHtml(error.message)}
              <br><br>
              <a href="${location.pathname}">
                새 방 만들기
              </a>
            </div>
          </section>
        `;
    }
  }
}


function renderRoom(room) {
  $("roomOptionSummary")
    .textContent =
      optionText(room);

  $("roundNumber")
    .textContent =
      room.round;

  $("stateBadge")
    .textContent =
      room.state;

  $("onlineCount")
    .textContent =
      `${room.onlineCount} / ${room.members.length}`;


  const myMember =
    getMyMember();

  const claimed =
    new Set(
      room.participants
        .map(
          (p) => p.member
        )
    );

  const myActive =
    myMember &&
    room.participants
      .some(
        (p) =>
          p.member === myMember &&
          p.mine
      );


  $("joinPanel").hidden =
    !!myActive;


  if (!myActive) {
    renderJoinGrid(
      room,
      claimed
    );
  }


  $("presenceList").innerHTML =
    room.members
      .map((name) => {
        const p =
          room.participants
            .find(
              (x) =>
                x.member === name
            );

        return `
          <div class="presence-row">
            <span class="presence-name">
              <span
                class="dot ${
                  p?.online
                    ? "online"
                    : ""
                }"
              ></span>

              ${escapeHtml(name)}
            </span>

            <span class="presence-state">
              ${
                p?.online
                  ? "입장"
                  : "대기"
              }
            </span>
          </div>
        `;
      })
      .join("");


  $("todayPanel").hidden =
    !room.options.todayCulprit;


  if (
    room.options.todayCulprit
  ) {
    renderToday(
      room.todayRanking || []
    );
  }


  renderGame(
    room,
    !!getHostToken(),
    myActive
  );
}


function renderJoinGrid(
  room,
  claimed
) {
  $("joinGrid").innerHTML = "";

  const myMember =
    getMyMember();


  for (
    const name of room.members
  ) {
    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.className =
      "member-button";

    button.textContent =
      name;


    if (
      claimed.has(name) &&
      name !== myMember
    ) {
      button.classList.add(
        "claimed"
      );
    }


    if (
      name === myMember
    ) {
      button.classList.add(
        "me"
      );
    }


    button.disabled =
      claimed.has(name) &&
      name !== myMember;


    button.onclick =
      () => joinAs(name);


    $("joinGrid")
      .appendChild(button);
  }
}


async function joinAs(name) {
  try {
    let token =
      getParticipantToken();

    if (!token) {
      token =
        randomToken();
    }


    const result =
      await api(
        "join",
        {
          method: "POST",

          body: JSON.stringify({
            roomId,
            member: name,
            participantToken: token
          })
        }
      );


    localStorage.setItem(
      storageKey("participant"),
      result.participantToken
    );

    localStorage.setItem(
      storageKey("member"),
      name
    );


    await heartbeat();

    await refreshRoom(true);
  } catch (error) {
    showToast(error.message);
  }
}


function renderPositions(room) {
  if (!room.positions) {
    return "";
  }


  if (
    room.queueType === 5
  ) {
    return `
      <div class="result-card">
        ${
          room.positions
            .map(
              (row) => `
                <div class="result-row">
                  <span class="role-label">
                    ${POSITION_CODES[row.position]}
                  </span>

                  <span class="player-name">
                    ${escapeHtml(row.player)}
                  </span>
                </div>
              `
            )
            .join("")
        }
      </div>
    `;
  }


  return `
    <div class="result-card">
      ${
        room.positions
          .map(
            (row) => `
              <div class="result-row">
                <span class="player-name">
                  ${escapeHtml(row.player)}
                </span>

                <span class="position-pair">
                  <strong>
                    주 · ${escapeHtml(row.primary)}
                  </strong>

                  <small>
                    부 · ${escapeHtml(row.secondary)}
                  </small>
                </span>
              </div>
            `
          )
          .join("")
      }
    </div>
  `;
}

function renderGame(
  room,
  isHost,
  myActive
) {
  const body =
    $("gameBody");

  const controls =
    $("hostControls");

  controls.innerHTML = "";


  if (
    room.state === "WAITING"
  ) {
    $("gameTitle")
      .textContent =
        "포지션 대기";

    const allIn =
      room.onlineCount ===
      room.members.length;

    body.innerHTML =
      `
        <div class="notice">
          ${
            allIn
              ? "전원 입장 완료. 포지션을 정할 수 있습니다."
              : `전원이 입장하면 포지션을 돌릴 수 있습니다. (${room.onlineCount}/${room.members.length})`
          }
        </div>
      `;

    if (isHost) {
      controls.innerHTML =
        `
          <button
            id="rollRoomButton"
            class="roll-button"
            ${allIn ? "" : "disabled"}
          >
            🎲 포지션 돌리기
          </button>
        `;

      $("rollRoomButton").onclick =
        () => hostAction("roll");
    }

    return;
  }


  if (
    room.state === "PLAYING"
  ) {
    $("gameTitle")
      .textContent =
        "게임 진행 중";

    body.innerHTML =
      renderPositions(room);

    if (isHost) {
      if (
        room.options.culpritVoting
      ) {
        controls.innerHTML =
          `
            <button
              id="winButton"
              class="roll-button secondary"
            >
              승리
            </button>

            <button
              id="lossButton"
              class="roll-button danger"
            >
              패배 · 범인 투표
            </button>
          `;

        $("winButton").onclick =
          () => hostAction("win");

        $("lossButton").onclick =
          () => hostAction("loss");
      } else {
        controls.innerHTML =
          `
            <button
              id="nextSimpleButton"
              class="roll-button"
            >
              다음 판
            </button>
          `;

        $("nextSimpleButton").onclick =
          () => hostAction("next");
      }
    }

    return;
  }


  if (
    room.state === "VOTING"
  ) {
    $("gameTitle")
      .textContent =
        "범인 투표";


    if (!myActive) {
      const existingProgress =
        document.getElementById(
          "voteProgress"
        );

      const existingNotice =
        body.querySelector(
          ".notice"
        );

      if (
        existingProgress &&
        existingNotice
      ) {
        existingProgress.textContent =
          `${room.voteCount} / ${room.members.length}명 투표 완료`;

        return;
      }

      body.innerHTML =
        `
          <div class="notice">
            참가자로 입장해야 투표할 수 있습니다.
          </div>

          <p
            class="vote-progress"
            id="voteProgress"
          >
            ${room.voteCount} / ${room.members.length}명 투표 완료
          </p>
        `;

      return;
    }


    if (
      room.myVoteSubmitted
    ) {
      const existingProgress =
        document.getElementById(
          "voteProgress"
        );

      const existingNotice =
        body.querySelector(
          ".notice"
        );

      if (
        existingProgress &&
        existingNotice
      ) {
        existingProgress.textContent =
          `${room.voteCount} / ${room.members.length}명 투표 완료`;

        return;
      }

      body.innerHTML =
        `
          <div class="notice">
            투표 완료.<br>
            모든 참가자의 투표를 기다리는 중입니다.
          </div>

          <p
            class="vote-progress"
            id="voteProgress"
          >
            ${room.voteCount} / ${room.members.length}명 투표 완료
          </p>
        `;

      return;
    }


    /*
     * 투표 폼이 이미 존재하면
     * polling 때 DOM을 다시 만들지 않는다.
     *
     * 따라서:
     * - 선택한 값 유지
     * - 열린 select 유지
     * - 모바일 선택창 강제 종료 방지
     *
     * 투표 진행 숫자만 변경한다.
     */
    const existingForm =
      document.getElementById(
        "submitVoteButton"
      );

    if (existingForm) {
      const progress =
        document.getElementById(
          "voteProgress"
        );

      if (progress) {
        progress.textContent =
          `${room.voteCount} / ${room.members.length}명 투표 완료`;
      }

      return;
    }


    body.innerHTML =
      voteFormHtml(room);

    $("submitVoteButton").onclick =
      submitVote;

    return;
  }


  if (
    room.state === "RESULT"
  ) {
    $("gameTitle")
      .textContent =
        "투표 결과";

    body.innerHTML =
      resultHtml(room);

    if (isHost) {
      controls.innerHTML =
        `
          <button
            id="nextRoundButton"
            class="roll-button"
          >
            다음 판
          </button>
        `;

      $("nextRoundButton").onclick =
        () => hostAction("next");
    }

    return;
  }
}

function voteFormHtml(room) {
  const options =
    room.members
      .map(
        (name) =>
          `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
      )
      .join("");


  const positionBlock =
    room.options.exile
      ? `
          <div class="vote-block">
            <label for="exilePosition">
              최종 범인의 다음 판 포지션
            </label>

            <select
              id="exilePosition"
              class="vote-select"
            >
              ${
                POSITIONS
                  .map(
                    (p) =>
                      `<option value="${p}">${p}</option>`
                  )
                  .join("")
              }
            </select>
          </div>
        `
      : "";


  return `
    <div class="vote-form">

      <div class="vote-block">
        <label for="primaryCulprit">
          주 범인 · +10점
        </label>

        <select
          id="primaryCulprit"
          class="vote-select"
        >
          ${options}
        </select>
      </div>


      <div class="vote-block">
        <label for="secondaryCulprit">
          부 범인 · +5점
        </label>

        <select
          id="secondaryCulprit"
          class="vote-select"
        >
          ${options}
        </select>
      </div>

      ${positionBlock}

      <button
        id="submitVoteButton"
        class="roll-button"
      >
        투표 완료
      </button>

      <p
        class="vote-progress"
        id="voteProgress"
      >
        ${room.voteCount} / ${room.members.length}명 투표 완료
      </p>

    </div>
  `;
}


async function submitVote() {
  const primary =
    $("primaryCulprit").value;

  const secondary =
    $("secondaryCulprit").value;


  if (
    primary === secondary
  ) {
    return showToast(
      "주 범인과 부 범인은 달라야 해요."
    );
  }


  const payload = {
    roomId,
    participantToken:
      getParticipantToken(),

    primary,
    secondary
  };


  if (
    currentRoom.options.exile
  ) {
    payload.exilePosition =
      $("exilePosition").value;
  }


  try {
    await api(
      "vote",
      {
        method: "POST",

        body:
          JSON.stringify(payload)
      }
    );

    await refreshRoom(true);
  } catch (error) {
    showToast(error.message);
  }
}


function resultHtml(room) {
  const result =
    room.result;


  if (!result) {
    return `
      <div class="notice">
        결과를 불러오는 중입니다.
      </div>
    `;
  }


  const scoreRows =
    result.scores
      .map(
        (row, i) => `
          <div class="score-row">
            <span class="rank-num">
              ${i + 1}
            </span>

            <span class="score-name">
              ${escapeHtml(row.member)}
            </span>

            <span class="score-value">
              ${row.score}점
            </span>
          </div>
        `
      )
      .join("");


  const exile =
    result.exilePosition
      ? `
          <div class="exile-banner">
            ${escapeHtml(result.culprit)}
            →
            다음 판
            ${escapeHtml(result.exilePosition)}
            고정
          </div>
        `
      : "";


  return `
    <div class="vote-result-title">
      <small>
        이번 판 최종 범인
      </small>

      <strong>
        ${escapeHtml(result.culprit)}
      </strong>
    </div>

    <div class="score-list">
      ${scoreRows}
    </div>

    ${exile}
  `;
}


function renderToday(ranking) {
  if (
    !ranking.length ||
    ranking.every(
      (row) => row.score === 0
    )
  ) {
    $("todayRanking").innerHTML =
      `
        <div class="notice">
          아직 누적 점수가 없습니다.
        </div>
      `;

    return;
  }


  $("todayRanking").innerHTML =
    ranking
      .map(
        (row, i) => `
          <div class="ranking-row">
            <span class="rank-num">
              ${i + 1}
            </span>

            <span class="score-name">
              ${escapeHtml(row.member)}
            </span>

            <span class="score-value">
              ${row.score}점
            </span>
          </div>
        `
      )
      .join("");
}


async function hostAction(action) {
  const hostToken =
    getHostToken();

  if (!hostToken) return;


  try {
    await api(
      "host",
      {
        method: "POST",

        body: JSON.stringify({
          roomId,
          hostToken,
          action
        })
      }
    );

    await refreshRoom(true);
  } catch (error) {
    showToast(error.message);
  }
}


$("copyLinkButton").onclick =
  async () => {
    try {
      await navigator.clipboard
        .writeText(
          location.href
        );

      showToast(
        "방 링크를 복사했어요."
      );
    } catch {
      showToast(
        "주소창의 링크를 복사해 주세요."
      );
    }
  };


document
  .querySelectorAll(".segment")
  .forEach((button) => {
    button.onclick = () => {
      queueSize =
        Number(
          button.dataset.queue
        );

      document
        .querySelectorAll(".segment")
        .forEach(
          (b) =>
            b.classList.toggle(
              "active",
              b === button
            )
        );

      if (
        selectedMembers.length >
        queueSize
      ) {
        selectedMembers =
          selectedMembers.slice(
            0,
            queueSize
          );
      }

      renderMemberPicker();
    };
  });


$("addCustomMember").onclick =
  addCustomName;


$("customName")
  .addEventListener(
    "keydown",
    (e) => {
      if (
        e.key === "Enter"
      ) {
        addCustomName();
      }
    }
  );


$("culpritToggle").onchange =
  syncOptionState;


$("createRoomButton").onclick =
  openCreateConfirm;


$("cancelCreate").onclick =
  () => {
    $("confirmModal").hidden =
      true;
  };


$("confirmCreate").onclick =
  createRoom;


if (roomId) {
  loadRoom();
} else {
  renderMemberPicker();
  syncOptionState();
}
