
const API_BASE = window.location.origin; // http://127.0.0.1:8000


let sessionId = null;
let chats = [];
let currentChat = { id: Date.now(), title: "New Chat", messages: [] };

const messagesDiv = document.getElementById("messages");
const sendBtn = document.getElementById("sendBtn");
const userInput = document.getElementById("userInput");
const fileInput = document.getElementById("fileInput");
const chatHistory = document.getElementById("chatHistory");
const newChatBtn = document.getElementById("newChatBtn");
const progressBox = document.getElementById("progress");
const progressBar = document.getElementById("progress-bar");
const progressTxt = document.getElementById("progress-text");

function setProgress(pct, text) {
  progressBox.classList.remove("hidden");
  progressBar.innerHTML = `<div style="width:${pct}%;height:100%;background:#2563eb;transition:width .2s"></div>`;
  progressTxt.textContent = text;
  if (pct >= 100) setTimeout(() => progressBox.classList.add("hidden"), 800);
}

function renderSlideCard(page, title, bullets) {
  const wrapper = document.createElement("div");
  wrapper.className = "slide-card";
  const h = document.createElement("div");
  h.className = "slide-title";
  h.innerHTML = `📑 <strong>Slide ${page}:</strong> ${escapeHtml(title || "")}`;
  const ul = document.createElement("ul");
  ul.className = "slide-bullets";
  bullets.forEach(b => { const li = document.createElement("li"); li.textContent = b; ul.appendChild(li); });
  wrapper.appendChild(h); wrapper.appendChild(ul);
  messagesDiv.appendChild(wrapper);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function escapeHtml(s) {
  return s?.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) || "";
}

// ---- UI helpers ----
function appendMessage(text, sender) {
  const msg = document.createElement("div");
  msg.classList.add("message", sender);

  // Simple formatting: keep it readable; render bullets & slide headers
  const formatted = text
    .replace(/\*\*Slide (\d+): (.*?)\*\*/g, '<div class="slide-title">📑 <strong>Slide $1:</strong> $2</div>')
    .replace(/\n•\s/g, "<ul><li>")
    .replace(/\n/g, "</li><li>")
    .replace(/<\/li><li>$/, "</li></ul>");

  msg.innerHTML = formatted;
  messagesDiv.appendChild(msg);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function saveMessage(text, sender) {
  currentChat.messages.push({ text, sender });
  if (!chats.includes(currentChat)) chats.push(currentChat);
  refreshChatList();
}

function refreshChatList() {
  chatHistory.innerHTML = "";
  chats.forEach((chat) => {
    const li = document.createElement("li");
    li.textContent = chat.title;
    li.title = chat.title;
    li.onclick = () => loadChat(chat.id);
    chatHistory.appendChild(li);
  });
}

function loadChat(id) {
  const chat = chats.find((c) => c.id === id);
  if (!chat) return;
  currentChat = chat;
  messagesDiv.innerHTML = "";
  chat.messages.forEach((m) => appendMessage(m.text, m.sender));
}

// ---- Backend call ----
async function sendToBackend({ message, file }) {
  const formData = new FormData();
  formData.append("message", message || "Summarize this presentation");
  if (sessionId) formData.append("session_id", sessionId);
  if (file) formData.append("file", file);

  const res = await fetch(`${API_BASE}/api/chat`, { method: "POST", body: formData });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Server error (${res.status}): ${txt || "no details"}`);
  }

  const data = await res.json();
  if (data.session_id) sessionId = data.session_id;

  // Prefer the big slide-by-slide summary if present; otherwise the single response
  const text = data.summary ? data.summary : data.response || "(no response)";
  return { text };
}

// ---- Events ----
async function sendMessage() {
  const message = userInput.value.trim();
  const file = fileInput.files[0] || null;

  if (!message && !file) return;

  if (file) {
    appendMessage(`📤 Uploading ${file.name}...`, "user");
    saveMessage(`📤 Uploading ${file.name}...`, "user");
  } else {
    appendMessage(message, "user");
    saveMessage(message, "user");
  }

  userInput.value = "";
  fileInput.value = "";

  try {
    const { text } = await sendToBackend({ message, file });
    appendMessage(text, "ai");
    saveMessage(text, "ai");

    // Set a nicer chat title the first time we get a summary
    if (currentChat.title === "New Chat" && text.startsWith("🧾")) {
      currentChat.title = "PPTX summary";
      refreshChatList();
    }
  } catch (err) {
    const msg = `❌ ${err.message}`;
    appendMessage(msg, "ai");
    saveMessage(msg, "ai");
  }
}

sendBtn.addEventListener("click", sendMessage);
userInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendMessage(); });
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;

  // 1) EXTRACT slides (fast)
  setProgress(3, "Uploading & extracting slides…");
  const form1 = new FormData(); form1.append("file", file);
  const r1 = await fetch("/api/extract", { method: "POST", body: form1 });
  const d1 = await r1.json();
  if (d1.error) { renderSlideCard("-", "Error", [d1.error]); return; }
  sessionId = d1.session_id;
  const slides = d1.slides || [];
  messagesDiv.innerHTML = ""; // clear area for results

  // 2) SUMMARIZE each slide (progress by slide)
  const total = slides.length || 1;
  for (let i = 0; i < slides.length; i++) {
    setProgress(Math.round((i / total) * 100), `Summarizing slide ${i + 1}/${total}…`);
    const s = slides[i];
    const form2 = new FormData();
    form2.append("session_id", sessionId);
    form2.append("page", s.page);
    form2.append("title", s.title || "");
    form2.append("text", s.text || "");
    const r2 = await fetch("/api/summarize/slide", { method: "POST", body: form2 });
    const d2 = await r2.json();
    renderSlideCard(d2.page, d2.title, d2.bullets || []);
  }
  setProgress(100, "Done");
});


refreshChatList();
