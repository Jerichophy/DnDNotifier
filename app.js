const webhookUrl = "https://discord.com/api/webhooks/1394696085494169690/7ZOhUsbaArmsYVsRD6U9FUXSNK5k69KZSJ874-ldmEB_mmdwu0e5nXXoqQSTsLI9FUlu";
console.log("debug newround build");

let nickname = "";
let userId = "";

async function sendDiscordNotification(message) {
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message })
    });
  } catch (err) {
    console.warn("Failed to send Discord notification:", err);
  }
}

function loginWithDiscord() {
  const clientId = "1394705358873690355";
  const redirectUri = encodeURIComponent("https://jerichophy.github.io/DnDNotifier/");
  const scope = "identify";
  const responseType = "token";

  // Save the current ?join param if present
  const joinName = new URLSearchParams(window.location.search).get("join");
  if (joinName) localStorage.setItem("pendingJoin", joinName);

  const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=${responseType}&scope=${scope}`;
  window.location.href = discordAuthUrl;
}


async function getUserInfoFromDiscord(token) {
  try {
    const response = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("Failed to fetch user info");
    return await response.json();
  } catch (error) {
    console.error("Discord user fetch failed:", error);
    alert("Failed to log in with Discord. Please try again.");
    return {};
  }
}

async function autoJoinAndViewSession(sessionName) {
  console.log(`[DEBUG] autoJoinAndViewSession() called for session: '${sessionName}'`);
  const { db, ref, get, set } = window.dndApp;

  const sessionRef = ref(db, `sessions/${sessionName}`);
  const pendingRef = ref(db, `sessions/${sessionName}/pendingPlayers/${userId}`);
  const approvedRef = ref(db, `sessions/${sessionName}/approvedPlayers/${userId}`);

  console.log("[DEBUG] Checking if session exists in Firebase...");
  const sessionSnap = await get(sessionRef);
  if (!sessionSnap.exists()) {
    console.warn(`[DEBUG] Session '${sessionName}' does not exist.`);
    alert(`Session '${sessionName}' does not exist.`);
    return;
  }

  if (!userId || !nickname) {
    console.warn("[DEBUG] Missing userId or nickname. Cannot proceed.");
    alert("Login not complete. Please try again.");
    return;
  }

  const session = sessionSnap.val();
  console.log("[DEBUG] Session data loaded:", session);

  if (session.dm?.id === userId) {
    console.log("[DEBUG] You are the DM. Viewing session directly.");
    viewSession(sessionName, "DM");
    return;
  }

  if (session.sessionLocked) {
    console.warn("[DEBUG] Session is locked. Cannot join.");
    alert("This session is locked. No new players can join.");
    return;
  }

  if ((await get(approvedRef)).exists()) {
    console.log("[DEBUG] User already approved. Viewing session.");
    viewSession(sessionName, "Player");
    return;
  }

  if ((await get(pendingRef)).exists()) {
    console.log("[DEBUG] User is already pending. Viewing session.");
    alert("You already requested to join. Waiting for DM approval.");
    viewSession(sessionName, "Pending");
    return;
  }

  console.log("[DEBUG] User not found in approved or pending. Prompting for readiness...");

  const readyAt = prompt("What time are you ready? (HH:MM)");
  const waitUntil = prompt("How long will you wait? (HH:MM)");
  if (!readyAt || !waitUntil) {
    console.warn("[DEBUG] User cancelled readiness prompts.");
    return;
  }

  console.log(`[DEBUG] Submitting join request with readyAt: ${readyAt}, waitUntil: ${waitUntil}`);

  await set(pendingRef, {
    name: nickname,
    readyAt,
    waitUntil
  });

  sendDiscordNotification(`🎲 ${nickname} requested to join '${sessionName}' — Ready At ${readyAt}, Wait Until ${waitUntil}`);
  alert("Join request sent. Waiting for DM approval.\n\n" + jesterWarning);

  viewSession(sessionName, "Pending");
}


async function handleDiscordLogin() {
  const hash = window.location.hash;
  if (!hash.includes("access_token")) {
    console.log("[DEBUG] No access token found in hash.");
    return null;
  }

  const params = new URLSearchParams(hash.slice(1));
  const token = params.get("access_token");
  if (!token) {
    console.warn("[DEBUG] Token not found in hash params.");
    return null;
  }

  console.log("[DEBUG] Found Discord token, attempting to fetch user info...");

  const user = await getUserInfoFromDiscord(token);
  if (!user?.id) {
    console.warn("[DEBUG] User info fetch failed or returned incomplete data:", user);
    return null;
  }

  console.log("[DEBUG] Successfully fetched user info:", user);

  nickname = `${user.username}#${user.discriminator}`;
  userId = user.id;

  return {
    userId,
    nickname,
    avatar: user.avatar,
    discriminator: user.discriminator
  };
}



function createSession() {
  const rawName = prompt("Name your session (e.g. 'curse-of-strahd')");
  if (!rawName) return;

  const name = rawName.toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!name) {
    alert("Invalid session name.");
    return;
  }

  const { db, ref, set, get } = window.dndApp;
  const sessionRef = ref(db, `sessions/${name}`);

  get(sessionRef).then((snapshot) => {
    if (snapshot.exists()) {
      alert("Session name already exists. Choose another.");
    } else {
      set(sessionRef, {
        dm: { username: nickname, id: userId },
        sessionLocked: false
      }).then(() => {
        sendDiscordNotification(getJesterCreateMessage(name, userId));
        alert(`Session '${name}' created.`);

        const inviteLink = `${window.location.origin}${window.location.pathname}?join=${name}`;
        const sessionList = document.getElementById("session-list");
        const inviteDiv = document.createElement("div");
        inviteDiv.innerHTML = `
          <p><strong>Invite Link:</strong></p>
          <button onclick="navigator.clipboard.writeText('${inviteLink}').then(() => alert('Link copied!'))">📋 Copy Invite Link</button>
          <a href="${inviteLink}" target="_blank" style="margin-left: 10px;">🔗 Open Invite Link</a>
        `;
        sessionList.prepend(inviteDiv);

        loadUserSessions();
      });
    }
  });
}

function joinSession() {
  const name = document.getElementById("session-id-input").value.trim().toLowerCase();
  if (!name) return;

  const { db, ref, set, get } = window.dndApp;
  const sessionRef = ref(db, `sessions/${name}`);
  const pendingRef = ref(db, `sessions/${name}/pendingPlayers/${userId}`);
  const approvedRef = ref(db, `sessions/${name}/approvedPlayers/${userId}`);

  get(sessionRef).then((snapshot) => {
    if (!snapshot.exists()) {
      alert("That session does not exist.");
      return;
    }

    const session = snapshot.val();
    if (session.sessionLocked) {
      alert("This session is locked. No new players can join.");
      return;
    }

    get(approvedRef).then((approvedSnap) => {
      if (approvedSnap.exists()) {
        alert("You are already part of this session.");
        return;
      }

      get(pendingRef).then((pendingSnap) => {
        if (pendingSnap.exists()) {
          const cancel = confirm("You already requested to join. Cancel request?");
          if (cancel) {
            set(pendingRef, null).then(() => {
              alert("Request cancelled.");
              loadUserSessions();
            });
          }
          return;
        }

        const readyAt = prompt("What time are you ready? (HH:MM)");
        const waitUntil = prompt("How long will you wait? (HH:MM)");
        if (!readyAt || !waitUntil) return;

        const jesterWarning = `🎭 Ahem! By joining this noble quest, you swear upon the sacred dice 🐉:\n\n"Those who join **must** honor the session time. Tardiness shall be punished with a **100 gold penalty**, to be split among those valiant adventurers already present in the call!"\n\nNo excuses! Not even a dragon attack. 🐲`;

        set(pendingRef, {
          name: nickname,
          readyAt,
          waitUntil
        }).then(() => {
          sendDiscordNotification(`🎲 ${nickname} requested to join '${name}' — Ready At ${readyAt}, Wait Until ${waitUntil}`);
          alert("Join request sent. Waiting for DM approval.\n\n" + jesterWarning);
          loadUserSessions();
        });
      });
    });
  });
}

function approvePlayer(name, id) {
  const { db, ref, get, set } = window.dndApp;
  const pendingRef = ref(db, `sessions/${name}/pendingPlayers/${id}`);
  const approvedRef = ref(db, `sessions/${name}/approvedPlayers/${id}`);

  get(pendingRef).then((snapshot) => {
    if (!snapshot.exists()) return;
    const player = snapshot.val();
    set(approvedRef, player).then(() => {
      set(pendingRef, null);
      sendDiscordNotification(`✅ ${player.name} has been approved for session '${name}'`);
    });
  });
}

function rejectPlayer(name, id) {
  const { db, ref, set } = window.dndApp;
  set(ref(db, `sessions/${name}/pendingPlayers/${id}`), null).then(() => {
    sendDiscordNotification(`❌ A player has been rejected from session '${name}'`);
  });
}

function lockSession(name) {
  const { db, ref, get, update } = window.dndApp;
  const approvedRef = ref(db, `sessions/${name}/approvedPlayers`);

  get(approvedRef).then((snapshot) => {
    const players = snapshot.val();
    if (!players) {
      alert("No approved players to calculate start time.");
      return;
    }
    const times = Object.values(players).map(p => p.readyAt).filter(Boolean);
    if (!times.length) {
      alert("No player availability to set session time.");
      return;
    }
    const latestTime = times.reduce((a, b) => a > b ? a : b);
    update(ref(db, `sessions/${name}`), { sessionLocked: true, sessionStartTime: latestTime }).then(() => {
      const { db, ref, get } = window.dndApp;
      get(ref(db, `sessions/${name}`)).then((sessionSnap) => {
        const session = sessionSnap.val();
        const message = getJesterLockMessage(name, latestTime, session.dm.id, Object.keys(players));
        sendDiscordNotification(message);
      });
      alert(`Session locked. Starts at ${latestTime}`);
      viewSession(name, "DM");
    });
  });
}

function unlockSession(name) {
  const { db, ref, update } = window.dndApp;
  update(ref(db, `sessions/${name}`), {
    sessionLocked: false,
    sessionStartTime: null
  }).then(() => {
    sendDiscordNotification(`🔓 Session '${name}' has been unlocked.`);
    alert("Session unlocked.");
    viewSession(name, "DM");
  });
}

function getJesterCreateMessage(sessionName, dmId) {
  const dmMention = `<@${dmId}>`;
  const messages = [
    `✨ A new adventure has begun! **'${sessionName}'** was just conjured into existence by ${dmMention}! Sharpen your swords! 🗡️`,
    `📜 Behold! A fresh session called **'${sessionName}'** is now open. ${dmMention} is calling all heroes (and maybe one goblin)!`,
    `🧙‍♂️ *A portal opens...* Welcome to **'${sessionName}'**, created by the mighty ${dmMention}! Ready your spells and snacks!`,
    `🎲 Ding ding! ${dmMention} just launched a new session: **'${sessionName}'**! Who's brave enough to join?`
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

function getJesterLockMessage(sessionName, time, dmId, playerIds) {
  const dmMention = `<@${dmId}>`;
  const playerMentions = playerIds.map(id => `<@${id}>`).join(", ");

  const messages = [
    `Oooohh~! The session **'${sessionName}'** is all locked up! 🗝 Starts at **${time}**!\n${dmMention}, you're in charge — don’t let the cookies burn! 🍪\nPlayers: ${playerMentions} be nice, okay?`,
    `Ding ding! It's happening! Session **'${sessionName}'** is gonna start at **${time}**! ${dmMention}, bring the sparkles! ✨\nHey ${playerMentions} — don’t be late or I’ll draw mustaches on your tokens!`,
    `*Whispers magically*... "The winds have spoken!" The session '${sessionName}' begins at **${time}** sharp! ${dmMention} is your fearless leader~\nAll adventurers ${playerMentions} better be ready or else... teeehee.`,
    `*CLAP!* Attention adventurers! Session **'${sessionName}'** is LOCKED! Starts at **${time}** sharp!\n${dmMention} is expecting you, ${playerMentions}. Don't make me send Sprinkle. 🐹`
  ];

  return messages[Math.floor(Math.random() * messages.length)];
}

function getJesterDeleteMessage(sessionName, dmId, playerIds = []) {
  const dmMention = `<@${dmId}>`;
  const playerMentions = playerIds.length ? playerIds.map(id => `<@${id}>`).join(", ") : "everyone";

  const messages = [
    `Oh nooo~! The session **'${sessionName}'** has been *poofed* into sparkly dust! ${dmMention}, was it on purpose? Just kidding... maybe.`,
    `Session **'${sessionName}'**? GONE! ${dmMention} waved their magical hands and now it’s all ✨ memories. Sorry ${playerMentions}, no more cookies today.`,
    `*In a dramatic whisper* The adventure of '${sessionName}'... has come to a close. ${dmMention}, you better not be deleting Sprinkle next. 😤`,
    `🎭 *Exit, stage left!* The curtains close on **'${sessionName}'**. ${dmMention}, the world shall remember... or maybe not. Bye ${playerMentions}~!`
  ];

  return messages[Math.floor(Math.random() * messages.length)];
}

function startNewRound(name) {
  const { db, ref, get, update } = window.dndApp;
  const approvedRef = ref(db, `sessions/${name}/approvedPlayers`);

  get(approvedRef).then((snapshot) => {
    const players = snapshot.val();
    if (!players) {
      alert("No approved players to reset.");
      console.warn("[DEBUG] No approved players found for new round.");
      return;
    }

    const updates = {
      [`sessions/${name}/sessionLocked`]: false,
      [`sessions/${name}/sessionStartTime`]: null
    };

    Object.entries(players).forEach(([playerId, playerData]) => {
      if (!playerId) {
        console.warn(`[DEBUG] Skipping invalid player key: '${playerId}'`);
        return;
      }
      updates[`sessions/${name}/approvedPlayers/${playerId}/readyAt`] = null;
      updates[`sessions/${name}/approvedPlayers/${playerId}/waitUntil`] = null;
    });

    console.log("[DEBUG] Submitting new round update with data:", updates);

    update(ref(db), updates)
      .then(() => {
        sendDiscordNotification(`🔁 A new round has started for session '${name}'.`);
        alert("New round started. Players can update their times.");
        viewSession(name, "DM");
      })
      .catch((err) => {
        console.error("[DEBUG] Firebase update failed during startNewRound:", err);
        alert("Failed to start new round. Please try again.");
      });

  }).catch((err) => {
    console.error("[DEBUG] Firebase get failed during startNewRound:", err);
    alert("Error loading player list.");
  });
}

function deleteSession(name) {
  const { db, ref, remove, get } = window.dndApp;

  if (confirm(`Are you sure you want to delete session '${name}'?`)) {
    const sessionRef = ref(db, `sessions/${name}`);

    get(sessionRef).then((snapshot) => {
      const session = snapshot.val();
      const dmId = session.dm?.id || "";
      const playerIds = Object.keys(session.approvedPlayers || {});

      remove(sessionRef).then(() => {
        const message = getJesterDeleteMessage(name, dmId, playerIds);
        sendDiscordNotification(message);
        alert("Session deleted.");
        backToDashboard();
        loadUserSessions();
      });
    });
  }
}

function viewSession(name, role) {
  document.getElementById("dashboard-section").classList.add("hidden");
  document.getElementById("session-view").classList.remove("hidden");
  document.getElementById("view-session-name").textContent = name;
  document.getElementById("view-role").textContent = `You are the ${role}`;
  const container = document.getElementById("session-details");
  container.innerHTML = "";

  const { db, ref, get, onValue } = window.dndApp;
  const sessionRef = ref(db, `sessions/${name}`);

  get(sessionRef).then((snapshot) => {
    const session = snapshot.val();
    let content = "";

    if (session.sessionStartTime) {
      content += `<p><strong>🕒 Session Start Time:</strong> ${session.sessionStartTime}</p>`;
    }

    // DM-only tools
    if (role === "DM") {
      const inviteLink = `${window.location.origin}${window.location.pathname}?join=${name}`;

      content += `
        <div style="margin-top: 20px; padding: 10px; border: 1px solid #ccc; border-radius: 10px;">
          <h3>📨 Invite Players</h3>
          <p><strong>Invite Link:</strong></p>
          <button onclick="navigator.clipboard.writeText('${inviteLink}').then(() => alert('Copied!'))">
            📋 Copy Invite Link
          </button>
          <a href="${inviteLink}" target="_blank" style="margin-left: 10px;">
            🔗 Open Invite Link
          </a>
        </div>

        <div style="margin-top: 20px; padding: 10px; border: 1px solid #ccc; border-radius: 10px;">
          <h3>🛠️ Session Controls</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 10px;">
            ${session.sessionLocked
              ? `<button onclick="unlockSession('${name}')">🔓 Unlock Session</button>`
              : `<button onclick="lockSession('${name}')">🔒 Lock Session</button>`}
            <button onclick="startNewRound('${name}')">🔁 Start New Round</button>
            <button onclick="deleteSession('${name}')">🗑️ Delete Session</button>
          </div>
        </div>
      `;
    }

    container.innerHTML = content;

    const approvedRef = ref(db, `sessions/${name}/approvedPlayers`);
    const pendingRef = ref(db, `sessions/${name}/pendingPlayers`);

    // Approved players
    onValue(approvedRef, (snapshot) => {
      const data = snapshot.val() || {};
      let html = `
        <div style="margin-top: 20px;">
          <h3>✅ Approved Players</h3>
          ${
            Object.keys(data).length
              ? "<ul>" + Object.entries(data).map(([_, p]) =>
                  `<li><strong>${p.name}</strong>: Ready At ${p.readyAt || 'Not set'}, Wait Until ${p.waitUntil || 'Not set'}</li>`).join("") + "</ul>"
              : "<i>No approved players yet.</i>"
          }
        </div>
      `;
      container.innerHTML += html;
    });

    // Pending players (DM only)
    if (role === "DM") {
      onValue(pendingRef, (snapshot) => {
        const data = snapshot.val() || {};
        let html = `
          <div style="margin-top: 20px;">
            <h3>⏳ Pending Players</h3>
            ${
              Object.keys(data).length
                ? "<ul>" + Object.entries(data).map(([id, p]) =>
                    `<li><strong>${p.name}</strong>: Ready At ${p.readyAt}, Wait Until ${p.waitUntil}
                      <button onclick="approvePlayer('${name}', '${id}')">✅ Approve</button>
                      <button onclick="rejectPlayer('${name}', '${id}')">❌ Reject</button>
                    </li>`).join("") + "</ul>"
                : "<i>No pending players.</i>"
            }
          </div>
        `;
        container.innerHTML += html;
      });
    }
  });
}

function loadUserSessions() {
  const { db, ref, get } = window.dndApp;
  const sessionList = document.getElementById("session-list");
  sessionList.innerHTML = "Loading...";

  get(ref(db, "sessions")).then((snapshot) => {
    const sessions = snapshot.val();
    sessionList.innerHTML = "";
    if (!sessions) {
      sessionList.innerHTML = "<i>No sessions found.</i>";
      return;
    }

    Object.entries(sessions).forEach(([name, session]) => {
      let role = "";
      let isIn = false;
      if (session.dm?.id === userId) {
        role = "DM";
        isIn = true;
      } else if (session.approvedPlayers?.[userId]) {
        role = "Player";
        isIn = true;
      } else if (session.pendingPlayers?.[userId]) {
        role = "Pending";
        isIn = true;
      }

      if (isIn) {
        sessionList.innerHTML += `<div><strong>${name}</strong> (${role}) <button onclick="viewSession('${name}', '${role}')">View</button></div>`;
      }
    });
  });
}

function backToDashboard() {
  document.getElementById("session-view").classList.add("hidden");
  document.getElementById("dashboard-section").classList.remove("hidden");
  loadUserSessions();
}

window.onload = async () => {
  console.log("[DEBUG] Page loaded. Checking URL and localStorage for join info...");
  const params = new URLSearchParams(window.location.search);
  let joinName = params.get("join");

  if (joinName) {
    console.log(`[DEBUG] Found join param in URL: ${joinName}`);
    localStorage.setItem("pendingJoin", joinName);
  }

  if (!joinName) {
    joinName = localStorage.getItem("pendingJoin");
    if (joinName) console.log(`[DEBUG] Restored join param from localStorage: ${joinName}`);
    localStorage.removeItem("pendingJoin");
  }

  const userInfo = await handleDiscordLogin();

  if (userInfo) {
    console.log(`[DEBUG] User info loaded:`, userInfo);
    userId = userInfo.userId;
    nickname = userInfo.nickname;

    document.getElementById("user-name").textContent = nickname;
    document.getElementById("avatar").src = userInfo.avatar
      ? `https://cdn.discordapp.com/avatars/${userId}/${userInfo.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/${parseInt(userInfo.discriminator) % 5}.png`;

    document.getElementById("discord-login").classList.add("hidden");
    document.getElementById("dashboard-section").classList.remove("hidden");
  } else {
    console.log("[DEBUG] No user info found. User not logged in.");
  }

  if (joinName && userId) {
    console.log(`[DEBUG] Attempting auto-join with session '${joinName}' for user '${userId}'`);
    await autoJoinAndViewSession(joinName.toLowerCase());
    return;
  }

  if (userInfo) {
    console.log("[DEBUG] Loading user sessions...");
    loadUserSessions();
  }

  console.log("[DEBUG] Cleaning URL to remove tokens/join params");
  window.history.replaceState({}, document.title, window.location.pathname);
};


window.loginWithDiscord = loginWithDiscord;
window.createSession = createSession;
window.joinSession = joinSession;
window.viewSession = viewSession;
window.backToDashboard = backToDashboard;
window.approvePlayer = approvePlayer;
window.rejectPlayer = rejectPlayer;
window.lockSession = lockSession;
window.unlockSession = unlockSession;
window.startNewRound = startNewRound;
window.deleteSession = deleteSession;