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

const POSITION_CODES = [
  "TOP",
  "JUNGLE",
  "MID",
  "ADC",
  "SUPPORT"
];

let queueSize = 5;

let selectedMembers = [];
let customMembers = [];

let isRolling = false;

const memberGrid =
  document.getElementById("memberGrid");

const memberCount =
  document.getElementById("memberCount");

const helperText =
  document.getElementById("helperText");

const rollButton =
  document.getElementById("rollButton");

const resultSection =
  document.getElementById("resultSection");

const resultCard =
  document.getElementById("resultCard");

const rerollButton =
  document.getElementById("rerollButton");

const customInputWrap =
  document.getElementById("customInputWrap");

const customNameInput =
  document.getElementById("customName");

const addCustomMember =
  document.getElementById("addCustomMember");


function shuffle(array) {
  const copy = [...array];

  for (let i = copy.length - 1; i > 0; i--) {
    const j =
      Math.floor(Math.random() * (i + 1));

    [copy[i], copy[j]] =
      [copy[j], copy[i]];
  }

  return copy;
}


function allMembers() {
  return [
    ...PRESET_MEMBERS,
    ...customMembers
  ];
}


function renderMembers() {
  memberGrid.innerHTML = "";

  allMembers().forEach((name) => {
    const button =
      document.createElement("button");

    button.type = "button";

    button.className =
      "member-button";

    button.textContent = name;

    button.dataset.name = name;

    const selected =
      selectedMembers.includes(name);

    const atLimit =
      selectedMembers.length >= queueSize;

    if (selected) {
      button.classList.add("selected");
    }

    if (!selected && atLimit) {
      button.classList.add(
        "limit-disabled"
      );
    }

    button.addEventListener(
      "click",
      () => toggleMember(name)
    );

    memberGrid.appendChild(button);
  });


  const customButton =
    document.createElement("button");

  customButton.type = "button";

  customButton.className =
    "member-button custom-trigger";

  customButton.textContent =
    "+ 직접 입력";

  customButton.addEventListener(
    "click",
    () => {
      customInputWrap.hidden =
        !customInputWrap.hidden;

      if (!customInputWrap.hidden) {
        customNameInput.focus();
      }
    }
  );

  memberGrid.appendChild(customButton);

  updateStatus();
}


function toggleMember(name) {
  if (isRolling) {
    return;
  }

  if (selectedMembers.includes(name)) {
    selectedMembers =
      selectedMembers.filter(
        (member) => member !== name
      );
  } else if (
    selectedMembers.length < queueSize
  ) {
    selectedMembers.push(name);
  }

  resultSection.hidden = true;

  renderMembers();
}


function updateStatus() {
  memberCount.textContent =
    `${selectedMembers.length} / ${queueSize}`;

  const remaining =
    queueSize - selectedMembers.length;

  if (remaining > 0) {
    helperText.textContent =
      `${remaining}명 더 선택해 주세요.`;

    rollButton.disabled = true;
  } else {
    helperText.textContent =
      "준비 완료. 포지션을 돌려보세요.";

    rollButton.disabled = false;
  }
}


function setQueueSize(size) {
  if (isRolling) {
    return;
  }

  queueSize = size;

  document
    .querySelectorAll(".segment")
    .forEach((button) => {
      button.classList.toggle(
        "active",
        Number(button.dataset.queue) === size
      );
    });

  if (
    selectedMembers.length > queueSize
  ) {
    selectedMembers =
      selectedMembers.slice(0, queueSize);
  }

  resultSection.hidden = true;

  renderMembers();
}


function addCustomName() {
  const name =
    customNameInput.value.trim();

  if (!name) {
    return;
  }

  if (allMembers().includes(name)) {
    helperText.textContent =
      "이미 있는 이름이에요.";

    customNameInput.select();

    return;
  }

  customMembers.push(name);

  customNameInput.value = "";

  if (
    selectedMembers.length < queueSize
  ) {
    selectedMembers.push(name);
  }

  customInputWrap.hidden = true;

  resultSection.hidden = true;

  renderMembers();
}


function generateFiveQueue() {
  const players =
    shuffle(selectedMembers);

  const roles =
    POSITIONS.map(
      (position, index) => ({
        position,
        code: POSITION_CODES[index]
      })
    );

  return roles.map(
    (role, index) => ({
      ...role,
      player: players[index]
    })
  );
}


function generateThreeQueue() {
  const players =
    shuffle(selectedMembers);

  const primaryPositions =
    shuffle(POSITIONS).slice(0, 3);

  return players.map(
    (player, index) => {
      const primary =
        primaryPositions[index];

      const secondaryPool =
        POSITIONS.filter(
          (position) =>
            position !== primary
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


function renderFiveQueue(result) {
  resultCard.innerHTML =
    result.map(
      ({ code, player }) => `
        <div class="result-row">
          <span class="role-label">
            ${code}
          </span>

          <span class="player-name">
            ${player}
          </span>
        </div>
      `
    ).join("");
}


function renderThreeQueue(result) {
  resultCard.innerHTML =
    result.map(
      ({
        player,
        primary,
        secondary
      }) => `
        <div class="threeq-row">
          <span class="threeq-name">
            ${player}
          </span>

          <div class="positions">
            <span class="position-pill primary">
              주 · ${primary}
            </span>

            <span class="position-pill">
              부 · ${secondary}
            </span>
          </div>
        </div>
      `
    ).join("");
}


function renderPreview() {
  if (queueSize === 5) {
    renderFiveQueue(
      generateFiveQueue()
    );
  } else {
    renderThreeQueue(
      generateThreeQueue()
    );
  }
}


async function roll() {
  if (
    selectedMembers.length !== queueSize ||
    isRolling
  ) {
    return;
  }

  isRolling = true;

  rollButton.classList.add(
    "rolling"
  );

  rollButton.textContent =
    "돌리는 중…";

  resultSection.hidden = false;

  for (let i = 0; i < 7; i++) {
    renderPreview();

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          70 + i * 14
        )
    );
  }

  if (queueSize === 5) {
    renderFiveQueue(
      generateFiveQueue()
    );
  } else {
    renderThreeQueue(
      generateThreeQueue()
    );
  }

  isRolling = false;

  rollButton.classList.remove(
    "rolling"
  );

  rollButton.textContent =
    "포지션 돌리기";

  resultSection.scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });
}


document
  .querySelectorAll(".segment")
  .forEach((button) => {
    button.addEventListener(
      "click",
      () =>
        setQueueSize(
          Number(button.dataset.queue)
        )
    );
  });


rollButton.addEventListener(
  "click",
  roll
);

rerollButton.addEventListener(
  "click",
  roll
);

addCustomMember.addEventListener(
  "click",
  addCustomName
);

customNameInput.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Enter") {
      addCustomName();
    }
  }
);


renderMembers();
