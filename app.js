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
  정글: "JG",
  미드: "MID",
  원딜: "ADC",
  서폿: "SUP"
};


const $ =
  id =>
    document.getElementById(id);


const roomId =
  new URLSearchParams(
    location.search
  ).get("r");


let queueSize = 5;

let selectedMembers = [];
let customMembers = [];

let currentRoom = null;

let pollTimer = null;
let heartbeatTimer = null;
let toastTimer = null;

let historyOffset = 0;

const HISTORY_PAGE_SIZE = 5;



/* =========================================================
   STORAGE
   ========================================================= */

const storageKey =
  kind =>
    `gwailnam:${roomId}:${kind}`;


const getHostToken =
  () =>
    roomId
      ? localStorage.getItem(
        storageKey("host")
      )
      : null;


const getParticipantToken =
  () =>
    roomId
      ? localStorage.getItem(
        storageKey("participant")
      )
      : null;


const getMyMember =
  () =>
    roomId
      ? localStorage.getItem(
        storageKey("member")
      )
      : null;



/* =========================================================
   UTILS
   ========================================================= */

function randomToken(
  bytes = 18
) {
  const data =
    new Uint8Array(bytes);

  crypto.getRandomValues(data);

  return Array
    .from(
      data,
      b =>
        b
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}


function escapeHtml(value) {
  return String(value ?? "")
    .replace(
      /[&<>"']/g,
      ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#039;"
      })[ch]
    );
}


function showToast(message) {
  $("toast").textContent =
    message;

  $("toast").hidden =
    false;

  clearTimeout(
    toastTimer
  );

  toastTimer =
    setTimeout(
      () => {
        $("toast").hidden =
          true;
      },
      1800
    );
}


async function api(
  path,
  options = {}
) {
  const response =
    await fetch(
      `/api/${path}`,
      {
        headers: {
          "Content-Type":
            "application/json",

          ...(
            options.headers ||
            {}
          )
        },

        ...options
      }
    );


  const data =
    await response
      .json()
      .catch(
        () => ({})
      );


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


function formatDate(
  timestamp
) {
  const date =
    new Date(
      Number(timestamp)
    );

  return new Intl.DateTimeFormat(
    "ko-KR",
    {
      month: "2-digit",
      day: "2-digit"
    }
  )
    .format(date)
    .replace(/\.\s*/g, ".")
    .replace(/\.$/, "");
}



/* =========================================================
   메인 멤버 선택
   ========================================================= */

function renderMemberPicker() {
  $("memberGrid").innerHTML =
    "";


  for (
    const name of
    allMembers()
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
      selectedMembers.includes(
        name
      )
    ) {
      button.classList.add(
        "selected"
      );
    }


    if (
      !selectedMembers.includes(
        name
      ) &&
      selectedMembers.length >=
      queueSize
    ) {
      button.classList.add(
        "limit-disabled"
      );
    }


    button.onclick =
      () => {
        if (
          selectedMembers.includes(
            name
          )
        ) {
          selectedMembers =
            selectedMembers.filter(
              value =>
                value !==
                name
            );
        } else if (
          selectedMembers.length <
          queueSize
        ) {
          selectedMembers.push(
            name
          );
        }

        renderMemberPicker();
      };


    $("memberGrid")
      .appendChild(
        button
      );
  }


  const custom =
    document.createElement(
      "button"
    );


  custom.type =
    "button";

  custom.className =
    "member-button custom-trigger";

  custom.textContent =
    "+ 직접 입력";


  custom.onclick =
    () => {
      $("customInputWrap").hidden =
        !$("customInputWrap").hidden;

      if (
        !$("customInputWrap").hidden
      ) {
        $("customName").focus();
      }
    };


  $("memberGrid")
    .appendChild(
      custom
    );


  $("memberCount").textContent =
    `${selectedMembers.length} / ${queueSize}`;


  const remaining =
    queueSize -
    selectedMembers.length;


  $("helperText").textContent =
    remaining
      ? `${remaining}명 더 선택해 주세요.`
      : "준비 완료.";


  $("createRoomButton").disabled =
    remaining !== 0;
}


function addCustomName() {
  const name =
    $("customName")
      .value
      .trim();


  if (!name) {
    return;
  }


  if (
    allMembers().includes(
      name
    )
  ) {
    showToast(
      "이미 있는 이름이에요."
    );

    return;
  }


  customMembers.push(
    name
  );


  $("customName").value =
    "";


  $("customInputWrap").hidden =
    true;


  if (
    selectedMembers.length <
    queueSize
  ) {
    selectedMembers.push(
      name
    );
  }


  renderMemberPicker();
}



/* =========================================================
   옵션
   ========================================================= */

function syncOptionState() {
  const enabled =
    $("culpritToggle").checked;


  for (
    const id of [
      "exileToggle",
      "todayToggle"
    ]
  ) {
    const input =
      $(id);


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
      input.checked =
        false;
    }
  }
}



/* =========================================================
   방 생성
   ========================================================= */

function openCreateConfirm() {
  const options = [
    `큐 타입: ${queueSize}인큐`,

    `멤버: ${selectedMembers.join(
      ", "
    )}`,

    `범인 투표: ${$("culpritToggle").checked
      ? "ON"
      : "OFF"
    }`
  ];


  if (
    $("culpritToggle").checked
  ) {
    options.push(
      `범인 유배: ${$("exileToggle").checked
        ? "ON"
        : "OFF"
      }`
    );


    options.push(
      `오늘의 범인: ${$("todayToggle").checked
        ? "ON"
        : "OFF"
      }`
    );
  }


  $("confirmSummary").innerHTML =
    options
      .map(
        value =>
          `<div>${escapeHtml(
            value
          )}</div>`
      )
      .join("");


  $("confirmModal").hidden =
    false;
}


async function createRoom() {
  $("confirmCreate").disabled =
    true;


  try {
    const result =
      await api(
        "create",
        {
          method: "POST",

          body:
            JSON.stringify({
              queueType:
                queueSize,

              members:
                selectedMembers,

              culpritVoting:
                $("culpritToggle")
                  .checked,

              exile:
                $("culpritToggle")
                  .checked &&
                $("exileToggle")
                  .checked,

              todayCulprit:
                $("culpritToggle")
                  .checked &&
                $("todayToggle")
                  .checked
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
    showToast(
      error.message
    );

    $("confirmCreate").disabled =
      false;
  }
}



/* =========================================================
   최근 영구 전적
   ========================================================= */

async function loadRecentHistory(
  append = false
) {
  try {
    const data =
      await api(
        `history?limit=${HISTORY_PAGE_SIZE}&offset=${historyOffset}`
      );


    if (!append) {
      $("recentHistory")
        .innerHTML =
        "";
    }


    if (
      !append &&
      !data.matches.length
    ) {
      $("recentHistory")
        .innerHTML =
        `
            <div class="history-empty">
              아직 저장된 전적이 없습니다.
            </div>
          `;

      $("moreHistoryButton").hidden =
        true;

      return;
    }


    for (
      const match of
      data.matches
    ) {
      $("recentHistory")
        .insertAdjacentHTML(
          "beforeend",
          historyCardHtml(
            match
          )
        );
    }


    historyOffset =
      data.nextOffset;


    $("moreHistoryButton").hidden =
      !data.hasMore;

  } catch {
    $("recentHistory")
      .innerHTML =
      `
          <div class="history-empty">
            전적을 불러오지 못했습니다.
          </div>
        `;
  }
}


function historyCardHtml(
  match
) {
  const win =
    match.result ===
    "WIN";


  const label =
    win
      ? "승"
      : "패";


  const className =
    win
      ? "win"
      : "loss";


  return `
    <article
      class="match-card ${className}"
    >

      <div class="match-card-head">

        <span class="match-date">
          ${formatDate(
    match.playedAt
  )}
        </span>

        <span
          class="match-result ${className}"
        >
          ${label}
        </span>

      </div>

      ${positionGridHtml(
    match.positions
  )}

    </article>
  `;
}


function positionGridHtml(
  positions
) {
  return `
    <div class="position-grid">

      ${POSITIONS
      .map(
        position => `
              <div class="position-slot">

                <span class="position-code">
                  ${POSITION_CODES[
          position
          ]
          }
                </span>

                <strong class="position-player">
                  ${positions[
            position
          ]
            ? escapeHtml(
              positions[
              position
              ]
            )
            : "-"
          }
                </strong>

              </div>
            `
      )
      .join("")
    }

    </div>
  `;
}



/* =========================================================
   방 진입
   ========================================================= */

function optionText(room) {
  const parts = [
    `${room.queueType}인큐`
  ];


  if (
    !room.options
      .culpritVoting
  ) {
    parts.push(
      "범인 투표 OFF"
    );
  } else {
    parts.push(
      "범인 투표"
    );


    if (
      room.options.exile
    ) {
      parts.push(
        "유배 ON"
      );
    }


    if (
      room.options
        .todayCulprit
    ) {
      parts.push(
        "오늘의 범인 ON"
      );
    }
  }


  return parts.join(
    " · "
  );
}


async function loadRoom() {
  $("homeView").hidden =
    true;

  $("roomView").hidden =
    false;

  $("roomCode").textContent =
    roomId;


  await refreshRoom(
    true
  );


  startTimers();
}



/* =========================================================
   POLLING
   ========================================================= */

function startTimers() {
  clearInterval(
    pollTimer
  );

  clearInterval(
    heartbeatTimer
  );


  pollTimer =
    setInterval(
      () => {
        if (
          document.visibilityState ===
          "visible"
        ) {
          refreshRoom(
            false
          );
        }
      },
      2000
    );


  heartbeatTimer =
    setInterval(
      () => {
        if (
          document.visibilityState ===
          "visible"
        ) {
          heartbeat();
        }
      },
      10000
    );


  document.addEventListener(
    "visibilitychange",
    () => {
      if (
        document.visibilityState ===
        "visible"
      ) {
        heartbeat();
        refreshRoom(
          false
        );
      }
    }
  );
}


async function heartbeat() {
  const token =
    getParticipantToken();


  if (!token) {
    return;
  }


  try {
    await api(
      "heartbeat",
      {
        method: "POST",

        body:
          JSON.stringify({
            roomId,

            participantToken:
              token
          })
      }
    );
  } catch { }
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
      query.set(
        "pt",
        token
      );
    }


    const room =
      await api(
        `state?${query.toString()}`
      );


    currentRoom =
      room;


    renderRoom(
      room
    );

  } catch (error) {
    if (loud) {
      showToast(
        error.message
      );
    }


    if (
      error.message.includes(
        "만료"
      )
    ) {
      clearInterval(
        pollTimer
      );

      clearInterval(
        heartbeatTimer
      );


      $("roomView").innerHTML =
        `
          <section class="panel">

            <div class="notice">

              ${escapeHtml(
          error.message
        )}

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



/* =========================================================
   방 렌더
   ========================================================= */

function renderRoom(room) {
  $("roomOptionSummary")
    .textContent =
    optionText(
      room
    );


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
          participant =>
            participant.member
        )
    );


  const myActive =
    myMember &&
    room.participants
      .some(
        participant =>
          participant.member ===
          myMember &&
          participant.mine
      );


  $("joinPanel").hidden =
    !!myActive;


  if (!myActive) {
    renderJoinGrid(
      room,
      claimed
    );
  }


  $("presenceList")
    .innerHTML =
    room.members
      .map(
        name => {
          const participant =
            room.participants
              .find(
                item =>
                  item.member ===
                  name
              );


          return `
              <div class="presence-row">

                <span class="presence-name">

                  <span
                    class="dot ${participant?.online
              ? "online"
              : ""
            }"
                  ></span>

                  ${escapeHtml(
              name
            )}

                </span>

                <span class="presence-state">
                  ${participant?.online
              ? "입장"
              : "대기"
            }
                </span>

              </div>
            `;
        }
      )
      .join("");


  $("todayPanel").hidden =
    !room.options
      .todayCulprit;


  if (
    room.options
      .todayCulprit
  ) {
    renderToday(
      room.todayRanking ||
      []
    );
  }


  renderGame(
    room,
    !!getHostToken(),
    myActive
  );


  renderRoundHistory(
    room,
    !!getHostToken()
  );
}



/* =========================================================
   참가자 이름 선택
   ========================================================= */

function renderJoinGrid(
  room,
  claimed
) {
  $("joinGrid").innerHTML =
    "";


  const myMember =
    getMyMember();


  for (
    const name of
    room.members
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
      () =>
        joinAs(
          name
        );


    $("joinGrid")
      .appendChild(
        button
      );
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

          body:
            JSON.stringify({
              roomId,
              member: name,

              participantToken:
                token
            })
        }
      );


    localStorage.setItem(
      storageKey(
        "participant"
      ),
      result.participantToken
    );


    localStorage.setItem(
      storageKey(
        "member"
      ),
      name
    );


    await heartbeat();

    await refreshRoom(
      true
    );

  } catch (error) {
    showToast(
      error.message
    );
  }
}



/* =========================================================
   포지션 표시
   ========================================================= */

function normalizeLivePositions(
  room
) {
  const result = {
    탑: null,
    정글: null,
    미드: null,
    원딜: null,
    서폿: null
  };


  for (
    const row of
    room.positions || []
  ) {
    if (
      row.position
    ) {
      result[
        row.position
      ] =
        row.player;
    } else if (
      row.primary
    ) {
      result[
        row.primary
      ] =
        row.player;
    }
  }


  return result;
}


function renderPositions(room) {
  if (
    !room.positions
  ) {
    return "";
  }


  const normalized =
    normalizeLivePositions(
      room
    );


  return `
    <div class="live-position-card">

      ${positionGridHtml(
    normalized
  )}

    </div>
  `;
}



/* =========================================================
   게임 상태
   ========================================================= */

function renderGame(
  room,
  isHost,
  myActive
) {
  const body =
    $("gameBody");

  const controls =
    $("hostControls");


  /*
   * 투표 입력 도중에는
   * hostControls만 비우고,
   * select DOM을 재생성하지 않는다.
   */

  controls.innerHTML =
    "";


  /* -------------------------------------------------------
     WAITING
     ------------------------------------------------------- */

  if (
    room.state ===
    "WAITING"
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

          ${allIn
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


      $("rollRoomButton")
        .onclick =
        () =>
          hostAction(
            "roll"
          );
    }


    return;
  }


  /* -------------------------------------------------------
     PLAYING
     ------------------------------------------------------- */

  if (
    room.state ===
    "PLAYING"
  ) {
    $("gameTitle")
      .textContent =
      "게임 진행 중";


    body.innerHTML =
      renderPositions(
        room
      );


    if (isHost) {
      controls.innerHTML =
        `
          <button
            id="winButton"
            class="roll-button win-button"
          >
            승리
          </button>

          <button
            id="lossButton"
            class="roll-button danger"
          >
            ${room.options
          .culpritVoting
          ? "패배 · 범인 투표"
          : "패배"
        }
          </button>
        `;


      $("winButton")
        .onclick =
        () =>
          hostAction(
            "win"
          );


      $("lossButton")
        .onclick =
        () =>
          hostAction(
            "loss"
          );
    }


    return;
  }


  /* -------------------------------------------------------
     VOTING
     ------------------------------------------------------- */

  if (
    room.state ===
    "VOTING"
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
     * 이미 폼이 존재하면
     * 재렌더하지 않는다.
     *
     * select 열림/선택값 유지.
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
      voteFormHtml(
        room
      );


    $("submitVoteButton")
      .onclick =
      submitVote;


    return;
  }


  /* -------------------------------------------------------
     RESULT
     ------------------------------------------------------- */

  if (
    room.state ===
    "RESULT"
  ) {
    $("gameTitle")
      .textContent =
      "투표 결과";


    body.innerHTML =
      resultHtml(
        room
      );


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


      $("nextRoundButton")
        .onclick =
        () =>
          hostAction(
            "next"
          );
    }


    return;
  }
}



/* =========================================================
   투표
   ========================================================= */

function voteFormHtml(room) {
  const options =
    room.members
      .map(
        name =>
          `
            <option
              value="${escapeHtml(
            name
          )}"
            >
              ${escapeHtml(
            name
          )}
            </option>
          `
      )
      .join("");


  const exileBlock =
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

              ${POSITIONS
        .map(
          position =>
            `
                        <option
                          value="${position}"
                        >
                          ${position}
                        </option>
                      `
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


      ${exileBlock}


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
    $("primaryCulprit")
      .value;


  const secondary =
    $("secondaryCulprit")
      .value;


  if (
    primary ===
    secondary
  ) {
    showToast(
      "주 범인과 부 범인은 달라야 해요."
    );

    return;
  }


  const payload = {
    roomId,

    participantToken:
      getParticipantToken(),

    primary,
    secondary
  };


  if (
    currentRoom.options
      .exile
  ) {
    payload.exilePosition =
      $("exilePosition")
        .value;
  }


  try {
    await api(
      "vote",
      {
        method: "POST",

        body:
          JSON.stringify(
            payload
          )
      }
    );


    await refreshRoom(
      true
    );

  } catch (error) {
    showToast(
      error.message
    );
  }
}



/* =========================================================
   투표 결과
   ========================================================= */

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
        (
          row,
          index
        ) => `
          <div class="score-row">

            <span class="rank-num">
              ${index + 1}
            </span>

            <span class="score-name">
              ${escapeHtml(
          row.member
        )}
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

            ${escapeHtml(
        result.culprit
      )}
            →

            다음 판
            ${escapeHtml(
        result.exilePosition
      )}
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
        ${escapeHtml(
    result.culprit
  )}
      </strong>

    </div>


    <div class="score-list">
      ${scoreRows}
    </div>


    ${exile}
  `;
}



/* =========================================================
   오늘의 범인
   ========================================================= */

function renderToday(
  ranking
) {
  if (
    !ranking.length ||
    ranking.every(
      row =>
        row.score === 0
    )
  ) {
    $("todayRanking")
      .innerHTML =
      `
          <div class="notice">
            아직 누적 점수가 없습니다.
          </div>
        `;

    return;
  }


  $("todayRanking")
    .innerHTML =
    ranking
      .map(
        (
          row,
          index
        ) => `
            <div class="ranking-row">

              <span class="rank-num">
                ${index + 1}
              </span>

              <span class="score-name">
                ${escapeHtml(
          row.member
        )}
              </span>

              <span class="score-value">
                ${row.score}점
              </span>

            </div>
          `
      )
      .join("");
}



/* =========================================================
   라운드 기록
   ========================================================= */

function renderRoundHistory(
  room,
  isHost
) {
  const history =
    room.roundHistory ||
    [];


  $("roundHistoryCount")
    .textContent =
    `${history.length}판`;


  if (
    !history.length
  ) {
    $("roundHistory")
      .innerHTML =
      `
          <div class="notice">
            아직 완료된 게임이 없습니다.
          </div>
        `;
  } else {
    $("roundHistory")
      .innerHTML =
      history
        .map(
          round =>
            roundHistoryHtml(
              round
            )
        )
        .join("");
  }


  $("exportArea").hidden =
    !isHost ||
    history.length === 0;


  if (
    isHost &&
    history.length
  ) {
    const count =
      Number(
        room.exportableCount ||
        0
      );


    $("exportHistoryButton").disabled =
      count === 0;


    $("exportHint").textContent =
      count > 0
        ? `아직 내보내지 않은 전적 ${count}판`
        : "모든 완료 전적을 내보냈습니다.";
  }
}


function roundHistoryHtml(
  round
) {
  const win =
    round.result ===
    "WIN";


  return `
    <article
      class="room-history-card ${win
      ? "win"
      : "loss"
    }"
    >

      <div class="room-history-head">

        <span>
          ROUND ${round.round}
        </span>

        <div class="room-history-tags">

          ${round.exported
      ? `
                  <span class="exported-badge">
                    저장됨
                  </span>
                `
      : ""
    }

          <span
            class="match-result ${win
      ? "win"
      : "loss"
    }"
          >
            ${win
      ? "승"
      : "패"
    }
          </span>

        </div>

      </div>


      ${positionGridHtml(
      round.positions
    )}


      ${round.culprit
      ? `
              <div class="round-culprit">
                범인 ·
                ${escapeHtml(
        round.culprit
      )}
              </div>
            `
      : ""
    }

    </article>
  `;
}



/* =========================================================
   방장 액션
   ========================================================= */

async function hostAction(
  action
) {
  const hostToken =
    getHostToken();


  if (!hostToken) {
    return;
  }


  try {
    const result =
      await api(
        "host",
        {
          method: "POST",

          body:
            JSON.stringify({
              roomId,
              hostToken,
              action
            })
        }
      );


    if (
      action === "export"
    ) {
      if (
        result.exported > 0
      ) {
        showToast(
          `${result.exported}판을 저장했습니다.`
        );
      } else {
        showToast(
          "새로 저장할 전적이 없습니다."
        );
      }
    }


    await refreshRoom(
      true
    );

  } catch (error) {
    showToast(
      error.message
    );
  }
}



/* =========================================================
   이벤트
   ========================================================= */

$("copyLinkButton")
  .onclick =
  async () => {
    try {
      await navigator
        .clipboard
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
  .querySelectorAll(
    ".segment"
  )
  .forEach(
    button => {
      button.onclick =
        () => {
          queueSize =
            Number(
              button.dataset
                .queue
            );


          document
            .querySelectorAll(
              ".segment"
            )
            .forEach(
              item =>
                item.classList
                  .toggle(
                    "active",
                    item ===
                    button
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
    }
  );


$("addCustomMember")
  .onclick =
  addCustomName;


$("customName")
  .addEventListener(
    "keydown",
    event => {
      if (
        event.key ===
        "Enter"
      ) {
        addCustomName();
      }
    }
  );


$("culpritToggle")
  .onchange =
  syncOptionState;


$("createRoomButton")
  .onclick =
  openCreateConfirm;


$("cancelCreate")
  .onclick =
  () => {
    $("confirmModal").hidden =
      true;
  };


$("confirmCreate")
  .onclick =
  createRoom;


$("moreHistoryButton")
  .onclick =
  () =>
    loadRecentHistory(
      true
    );


$("exportHistoryButton")
  .onclick =
  () =>
    hostAction(
      "export"
    );



/* =========================================================
   START
   ========================================================= */

if (roomId) {
  loadRoom();

} else {
  renderMemberPicker();

  syncOptionState();

  loadRecentHistory();
}