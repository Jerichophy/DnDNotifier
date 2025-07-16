const webhookUrl = "https://discord.com/api/webhooks/1394696085494169690/7ZOhUsbaArmsYVsRD6U9FUXSNK5k69KZSJ874-ldmEB_mmdwu0e5nXXoqQSTsLI9FUlu";

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
  const discordAuthUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=${responseType}&scope=${scope}`;
  window.location.href = discordAuthUrl;
}

async function getUserInfoFromDiscord(token) {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${token}` }
  });
  return await response.json();
}

async function handleDiscordLogin() {
  const hash = window.location.hash;
  if (!hash.includes("access_token")) return;

  const params = new URLSearchParams(hash.slice(1));
  const token = params.get("access_token");
  if (!token) return;

  const user = await getUserInfoFromDiscord(token);
  nickname = `${user.username}#${user.discriminator}`;
  userId = user.id;

  document.getElementById("user-name").textContent = nickname;
  document.getElementById("avatar").src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
  document.getElementById("discord-login").classList.add("hidden");
  document.getElementById("dashboard-section").classList.remove("hidden");

  loadUserSessions();
}

function createSession() {
  const name = prompt("Name your session (e.g. 'curse-of-strahd')")?.toLowerCase().replace(/\s+/g, "-");
  if (!name) return;

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
        alert(`Session '${name}' created.`);
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

        set(pendingRef, {
          name: nickname,
          readyAt,
          waitUntil
        }).then(() => {
          sendDiscordNotification(`🎲 ${nickname} requested to join '${name}' — Ready At ${readyAt}, Wait Until ${waitUntil}`);
          alert("Join request sent. Waiting for DM approval.");
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

function startNewRound(name) {
  const { db, ref, get, update } = window.dndApp;
  const approvedRef = ref(db, `sessions/${name}/approvedPlayers`);
  get(approvedRef).then((snapshot) => {
    const updates = {
      [`sessions/${name}/sessionLocked`]: false,
      [`sessions/${name}/sessionStartTime`]: null
    };
    snapshot.forEach(child => {
      updates[`sessions/${name}/approvedPlayers/${child.key}/readyAt`] = null;
      updates[`sessions/${name}/approvedPlayers/${child.key}/waitUntil`] = null;
    });
    update(db, updates).then(() => {
      sendDiscordNotification(`🔁 A new round has started for session '${name}'.`);
      alert("New round started. Players can update their times.");
      viewSession(name, "DM");
    });
  });
}

function deleteSession(name) {
  const { db, ref, remove } = window.dndApp;
  if (confirm(`Are you sure you want to delete session '${name}'?`)) {
    remove(ref(db, `sessions/${name}`)).then(() => {
      sendDiscordNotification(`🗑️ Session '${name}' has been deleted.`);
      alert("Session deleted.");
      backToDashboard();
      loadUserSessions();
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
    if (session.sessionStartTime) {
      container.innerHTML += `<p><strong>Session Start Time:</strong> ${session.sessionStartTime}</p>`;
    }
    if (role === "DM") {
      container.innerHTML += session.sessionLocked
        ? `<button onclick="unlockSession('${name}')">🔓 Unlock Session</button>`
        : `<button onclick="lockSession('${name}')">🔒 Lock Session</button>`;
      container.innerHTML += `<button onclick="startNewRound('${name}')">🔁 Start New Round</button>`;
      container.innerHTML += `<button onclick="deleteSession('${name}')">🗑️ Delete Session</button>`;
    }
  });

  const approvedRef = ref(db, `sessions/${name}/approvedPlayers`);
  const pendingRef = ref(db, `sessions/${name}/pendingPlayers`);

  onValue(approvedRef, (snapshot) => {
    const data = snapshot.val() || {};
    let html = "<h3>Approved Players</h3>";
    html += Object.keys(data).length
      ? "<ul>" + Object.entries(data).map(([_, p]) =>
          `<li><strong>${p.name}</strong>: Ready At ${p.readyAt || 'Not set'}, Wait Until ${p.waitUntil || 'Not set'}</li>`).join("") + "</ul>"
      : "<i>No approved players yet.</i>";
    container.innerHTML += html;
  });

  if (role === "DM") {
    onValue(pendingRef, (snapshot) => {
      const data = snapshot.val() || {};
      let html = "<h3>Pending Players</h3>";
      html += Object.keys(data).length
        ? "<ul>" + Object.entries(data).map(([id, p]) =>
            `<li><strong>${p.name}</strong>: Ready At ${p.readyAt}, Wait Until ${p.waitUntil}
              <button onclick="approvePlayer('${name}', '${id}')">✅ Approve</button>
              <button onclick="rejectPlayer('${name}', '${id}')">❌ Reject</button></li>`).join("") + "</ul>"
        : "<i>No pending players.</i>";
      container.innerHTML += html;
    });
  }
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

window.onload = handleDiscordLogin;
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