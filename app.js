// app.js — Cleaned version without availability functionality

const webhookUrl = "https://discord.com/api/webhooks/1394696085494169690/7ZOhUsbaArmsYVsRD6U9FUXSNK5k69KZSJ874-ldmEB_mmdwu0e5nXXoqQSTsLI9FUlu";
console.log("[DEBUG] NEWS app.js loaded: If you see this, it's the latest build");

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

  const sessionSnap = await get(sessionRef);
  if (!sessionSnap.exists()) {
    alert(`Session '${sessionName}' does not exist.`);
    return;
  }

  if (!userId || !nickname) {
    alert("Login not complete. Please try again.");
    return;
  }

  const session = sessionSnap.val();

  if (session.dm?.id === userId) {
    viewSession(sessionName, "DM");
    return;
  }

  if (session.sessionLocked) {
    alert("This session is locked. No new players can join.");
    return;
  }

  if ((await get(approvedRef)).exists()) {
    viewSession(sessionName, "Player");
    return;
  }

  if ((await get(pendingRef)).exists()) {
    alert("You already requested to join. Waiting for DM approval.");
    viewSession(sessionName, "Pending");
    return;
  }

  await set(pendingRef, { name: nickname });
  sendDiscordNotification(`🎲 ${nickname} requested to join '${sessionName}'`);
  alert("Join request sent. Waiting for DM approval.");
  viewSession(sessionName, "Pending");
}

// More functions like createSession, joinSession, viewSession, lockSession, etc.
// All availability handling, modal and datetime code removed for clarity.

// Final onload setup
window.onload = async () => {
  const params = new URLSearchParams(window.location.search);
  let joinName = params.get("join");

  if (joinName) {
    localStorage.setItem("pendingJoin", joinName);
  } else {
    localStorage.removeItem("pendingJoin");
  }

  const userInfo = await handleDiscordLogin();
  if (!userInfo) {
    if (joinName) localStorage.setItem("pendingJoin", joinName);
    loginWithDiscord();
    return;
  }

  userId = userInfo.userId;
  nickname = userInfo.nickname;

  document.getElementById("user-name").textContent = nickname;
  document.getElementById("avatar").src = userInfo.avatar
    ? `https://cdn.discordapp.com/avatars/${userId}/${userInfo.avatar}.png`
    : `https://cdn.discordapp.com/embed/avatars/${parseInt(userInfo.discriminator) % 5}.png`;

  document.getElementById("discord-login").classList.add("hidden");
  document.getElementById("dashboard-section").classList.remove("hidden");

  if (joinName) {
    alert(`Found a join link for session '${joinName}' — click \"Join Session\" to continue.`);
  }

  loadUserSessions();
  window.history.replaceState({}, document.title, window.location.pathname);
};
