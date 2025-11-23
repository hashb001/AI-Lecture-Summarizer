
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


function appendMessage(text, sender) {
  const msg = document.createElement("div");
  msg.classList.add("message", sender);

  // FIX: Use simple <br> tags instead of complex nested lists
  let formatted = text
    .replace(/\*\*Slide (\d+): (.*?)\*\*/g, '<br><strong style="font-size:1.1em">📑 Slide $1: $2</strong><br>')
    .replace(/\n•\s/g, "<br>• ")  // Bullet points
    .replace(/\n/g, "<br>");      // Newlines

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


async function sendToBackend({ message, file }) {
  console.log("sendToBackend", { message, sessionId, fileName: file ? file.name : null });
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

  // Prioritize response over summary (response is for chat, summary is for file upload)
  const text = data.response || data.summary || "(no response)";
  return { text };
}


// File input handler - processes file uploads separately
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  
  setProgress(3, "Uploading & extracting slides…");
  const form1 = new FormData(); form1.append("file", file);
  const r1 = await fetch("/api/extract", { method: "POST", body: form1 });
  const d1 = await r1.json();
  if (d1.error) { 
    renderSlideCard("-", "Error", [d1.error]); 
    fileInput.value = ""; // Clear on error too
    return; 
  }
  sessionId = d1.session_id;
  const slides = d1.slides || [];
  messagesDiv.innerHTML = ""; 

  const total = slides.length || 1;
  for (let i = 0; i < slides.length; i++) {
    // show progress using completed slides
    setProgress(Math.round(((i + 1) / total) * 100), `Summarizing slide ${i + 1}/${total}…`);
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
  
  // Clear the input after processing to prevent re-uploading when asking for slides
  fileInput.value = "";
});

// Main sendMessage function - handles chat messages (not file uploads)
async function sendMessage() {
  const message = userInput.value.trim();
  
  // Don't send file from input - file uploads are handled by fileInput change event
  // Only send file if explicitly provided (which won't happen in normal chat flow)
  const file = null;

  if (!message) return;

  if (!sessionId) {
    appendMessage('⚠️ Upload a PPTX first to ask follow-up questions.', 'ai');
    return;
  }

  appendMessage(message, "user");
  saveMessage(message, "user");

  userInput.value = "";

  try {
    const { text } = await sendToBackend({ message, file });
    appendMessage(text, "ai");
    saveMessage(text, "ai");

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

refreshChatList();
