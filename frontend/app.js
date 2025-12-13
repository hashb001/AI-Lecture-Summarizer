
const API_BASE = window.location.origin;

let sessionId = null;
let chats = [];
let currentChat = { id: Date.now(), title: "New Chat", messages: [] };
let authToken = localStorage.getItem("als_token") || "";
let currentUser = null;
let courses = [];
let selectedCourseId = Number(localStorage.getItem("als_course_id")) || null;
let savedSummaries = [];

const messagesDiv = document.getElementById("messages");
const sendBtn = document.getElementById("sendBtn");
const userInput = document.getElementById("userInput");
const fileInput = document.getElementById("fileInput");
const chatHistory = document.getElementById("chatHistory");
const newChatBtn = document.getElementById("newChatBtn");
const progressBox = document.getElementById("progress");
const progressBar = document.getElementById("progress-bar");
const progressTxt = document.getElementById("progress-text");

const authPanel = document.getElementById("authPanel");
const authFields = document.getElementById("authFields");
const authStatus = document.getElementById("authStatus");
const authNameInput = document.getElementById("authName");
const authEmailInput = document.getElementById("authEmail");
const authPasswordInput = document.getElementById("authPassword");
const signupBtn = document.getElementById("signupBtn");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
if (authEmailInput) authEmailInput.value = "";
if (authPasswordInput) authPasswordInput.value = "";
if (authNameInput) authNameInput.value = "";
if (userInput) userInput.value = "";

const coursePanel = document.getElementById("coursePanel");
const courseSelect = document.getElementById("courseSelect");
const courseNameInput = document.getElementById("courseName");
const courseSubjectInput = document.getElementById("courseSubject");
const createCourseBtn = document.getElementById("createCourseBtn");

const summaryList = document.getElementById("summaryList");
const summaryEmpty = document.getElementById("summaryEmpty");
const themeToggle = document.getElementById("themeToggle");
const savedTheme = localStorage.getItem("als_theme") || "light";
if (savedTheme === "dark") {
  document.body.classList.add("dark");
}
const assignmentList = document.getElementById("assignmentList");
const quizList = document.getElementById("quizList");
const assignmentEmpty = document.getElementById("assignmentEmpty");
const quizEmpty = document.getElementById("quizEmpty");

let isSignupMode = false;
document.addEventListener("click", async (e) => {

  if (e.target.classList.contains("generateQuizBtn")) {
    await createQuiz();
  }

  if (e.target.classList.contains("generateAssignmentBtn")) {
    await createAssignment();
  }
});
function setProgress(pct, text) {
  progressBox.classList.remove("hidden");
  progressBar.innerHTML = `<div style="width:${pct}%;height:100%;background:#2563eb;transition:width .2s"></div>`;
  progressTxt.textContent = text;
  if (pct >= 100) setTimeout(() => progressBox.classList.add("hidden"), 900);
}

function renderSlideCard(page, title, bullets) {
  const wrapper = document.createElement("div");
  wrapper.className = "slide-card";
  const h = document.createElement("div");
  h.className = "slide-title";
  h.innerHTML = `📑 <strong>Slide ${page}:</strong> ${escapeHtml(title || "")}`;
  const ul = document.createElement("ul");
  ul.className = "slide-bullets";
  bullets.forEach((b) => {
    const li = document.createElement("li");
    li.textContent = b;
    ul.appendChild(li);
  });
  wrapper.appendChild(h);
  wrapper.appendChild(ul);
  messagesDiv.appendChild(wrapper);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
function highlightSlides(pages) {
  const pageSet = new Set(pages.map(Number));
  document.querySelectorAll(".slide-card").forEach((card) => {
    const titleEl = card.querySelector(".slide-title");
    if (!titleEl) return;
    const m = titleEl.textContent.match(/Slide\s+(\d+)/i);
    const page = m ? Number(m[1]) : null;
    if (page && pageSet.has(page)) {
      card.classList.add("slide-highlight");
      setTimeout(() => card.classList.remove("slide-highlight"), 1500);
    }
  });
}
function escapeHtml(s) {
  return (
    s?.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])) || ""
  );
}

function appendMessage(text, sender) {
  const msg = document.createElement("div");
  msg.classList.add("message", sender);
  let formatted = text
    .replace(/\*\*Slide (\d+): (.*?)\*\*/g, '<br><strong style="font-size:1.1em">📑 Slide $1: $2</strong><br>')
    .replace(/\n•\s/g, "<br>• ")
    .replace(/\n/g, "<br>");
  msg.innerHTML = formatted;
  messagesDiv.appendChild(msg);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  document.getElementById("chat-container").classList.add("has-messages");
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

function setAuthToken(token) {
  authToken = token;
  if (token) {
    localStorage.setItem("als_token", token);
  } else {
    localStorage.removeItem("als_token");
  }
}

function updateAuthUI() {
  if (currentUser) {
    authStatus.textContent = `Signed in as ${
      currentUser.full_name || currentUser.email
    }`;

    authPanel.classList.add("logged-in");
    if (authFields) authFields.style.display = "none";
    logoutBtn.classList.remove("hidden");
    coursePanel.classList.remove("hidden");
  } else {
    authStatus.textContent = "Guest mode (sign in to save summaries)";

    authPanel.classList.remove("logged-in");
    if (authFields) authFields.style.display = "block";
    logoutBtn.classList.add("hidden");
    coursePanel.classList.add("hidden");
  }

  summaryEmpty.textContent = currentUser
    ? "Pick a course to see saved summaries."
    : "Log in to view saved summaries.";
}


async function refreshAuthState() {
  authToken = localStorage.getItem("als_token") || null;
  currentUser = null;

  if (!authToken) {
    authPanel.classList.remove("logged-in");
    authStatus.textContent = "Guest mode (sign in to save summaries)";
    if (authFields) authFields.style.display = "block";
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) throw new Error("unauthorized");
    const data = await res.json();
    currentUser = data;

    // 🔹 keep whatever selectedCourseId is already set to
    authStatus.textContent = `Signed in as ${
      currentUser.full_name || currentUser.email
    }`;
    authPanel.classList.add("logged-in");
    if (authFields) authFields.style.display = "none";
  } catch (e) {
    authToken = null;
    localStorage.removeItem("als_token");
    currentUser = null;
    authPanel.classList.remove("logged-in");
    authStatus.textContent = "Guest mode (sign in to save summaries)";
    if (authFields) authFields.style.display = "block";
  }
}




async function registerUser() {
  const payload = {
    full_name: authNameInput.value.trim() || null,
    email: authEmailInput.value.trim(),
    password: authPasswordInput.value.trim(),
  };
  if (!payload.email || !payload.password) {
    appendMessage("⚠️ Email and password are required to register.", "ai");
    return;
  }
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    appendMessage(`❌ ${data.detail || "Could not register"}`, "ai");
    return;
  }
  appendMessage("✅ Account created. You can log in now.", "ai");
}

async function loginUser() {
  const payload = {
    email: authEmailInput.value.trim(),
    password: authPasswordInput.value.trim(),
  };
  if (!payload.email || !payload.password) {
    appendMessage("⚠️ Email and password are required to log in.", "ai");
    return;
  }

  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    appendMessage(`❌ ${data.detail || "Invalid login"}`, "ai");
    return;
  }

  setAuthToken(data.access_token);
  authPasswordInput.value = "";

  // set currentUser
  await refreshAuthState();
  // load user's courses
  await fetchCourses();
  // update UI (shows course panel, logout button, hides auth form)
  updateAuthUI();

  appendMessage(
    "✅ Logged in. Choose or create a course to save summaries.",
    "ai"
  )
}



function logoutUser() {
  setAuthToken("");
  currentUser = null;
  courses = [];
  selectedCourseId = null;
  localStorage.removeItem("als_course_id");
  updateAuthUI();
  appendMessage("👋 Logged out. Summaries will no longer be saved.", "ai");
}

async function fetchCourses() {
  if (!currentUser) return;
  const res = await fetch("/api/courses", {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) return;
  courses = await res.json();
  populateCourseSelect();
  if (courses.length && !selectedCourseId) {
    setSelectedCourse(courses[0].id);
  } else if (selectedCourseId) {
    const exists = courses.some((c) => c.id === Number(selectedCourseId));
    if (!exists) {
      setSelectedCourse(courses[0]?.id || null);
    } else {
      await fetchSummaries();
    }
  }
}
async function createQuiz() {
  if (!currentUser || !selectedCourseId) {
    appendMessage("⚠️ You must log in and select a course first.", "ai");
    return;
  }
  if (!sessionId) {
    appendMessage("⚠️ Upload and summarize a lecture first.", "ai");
    return;
  }

  // 1. Get context for this session
  const resCtx = await fetch(`/api/debug/session/${sessionId}`);
  const sessData = await resCtx.json();
  const text = sessData.summary || sessData.pptx_text_preview || "";
  if (!text.trim()) {
    appendMessage("⚠️ Could not load lecture content for this session.", "ai");
    return;
  }

  // 2. Build headers (include token!)
  const headers = { "Content-Type": "application/json" };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  // 3. Call quiz endpoint
  const res = await fetch(`/api/quizzes/${selectedCourseId}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ session_text: text }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    appendMessage(
      `❌ Failed to generate quiz: ${err.detail || res.statusText}`,
      "ai"
    );
    return;
  }

  const data = await res.json();
  appendMessage("📝 Quiz generated:\n\n" + data.content, "ai");

  // 4. Refresh quiz list in the sidebar
  loadQuizzes(selectedCourseId);
}



async function createAssignment() {
  if (!currentUser || !selectedCourseId) {
    appendMessage("⚠️ You must log in and select a course first.", "ai");
    return;
  }
  if (!sessionId) {
    appendMessage("⚠️ Upload and summarize a lecture first.", "ai");
    return;
  }

  // Fetch context from backend debug endpoint (same idea as createQuiz)
  const resCtx = await fetch(`/api/debug/session/${sessionId}`);
  const sessData = await resCtx.json();
  const text = sessData.summary || sessData.pptx_text_preview || "";
  if (!text.trim()) {
    appendMessage("⚠️ Could not load lecture content for this session.", "ai");
    return;
  }

  const headers = { "Content-Type": "application/json" };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const res = await fetch(`/api/assignments/${selectedCourseId}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ session_text: text }),
  });


  const data = await res.json();

  appendMessage("📘 Assignment generated:\n\n" + data.content, "ai");

  loadAssignments(selectedCourseId);
}

async function loadAssignments(courseId) {
  if (!courseId) return;

  const headers = {};
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const res = await fetch(`/api/courses/${courseId}/assignments`, { headers });
  const assignments = await res.json();

  if (!assignments.length) {
    assignmentList.innerHTML = "";
    if (assignmentEmpty) assignmentEmpty.style.display = "block";
    return;
  }
  if (assignmentEmpty) assignmentEmpty.style.display = "none";

  assignmentList.innerHTML = assignments
    .map((a) => `<li>${a.title}</li>`)
    .join("");
}



async function loadQuizzes(courseId) {
  if (!courseId) return;

  const headers = {};
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const res = await fetch(`/api/courses/${courseId}/quizzes`, { headers });
  const quizzes = await res.json();

  if (!quizzes.length) {
    quizList.innerHTML = "";
    if (quizEmpty) quizEmpty.style.display = "block";
    return;
  }
  if (quizEmpty) quizEmpty.style.display = "none";

  quizList.innerHTML = quizzes
    .map((q) => `<li>${q.title}</li>`)
    .join("");
}




function populateCourseSelect() {
  courseSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = courses.length ? "Select a course" : "No courses yet";
  courseSelect.appendChild(placeholder);
  courses.forEach((course) => {
    const option = document.createElement("option");
    option.value = course.id;
    option.textContent = course.subject ? `${course.name} · ${course.subject}` : course.name;
    if (Number(course.id) === Number(selectedCourseId)) {
      option.selected = true;
    }
    courseSelect.appendChild(option);
  });
}

async function handleCreateCourse() {
  if (!currentUser) {
    appendMessage("⚠️ You must be logged in to create courses.", "ai");
    return;
  }
  const payload = {
    name: courseNameInput.value.trim(),
    subject: null,
  };
  if (!payload.name) {
    appendMessage("⚠️ Enter a course name first.", "ai");
    return;
  }
  const res = await fetch("/api/courses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    appendMessage(`❌ ${data.detail || "Could not create course"}`, "ai");
    return;
  }
  courseNameInput.value = "";
  if (courseSubjectInput) courseSubjectInput.value = "";
  await fetchCourses();
  setSelectedCourse(data.id);
  appendMessage(`✅ Course "${data.name}" created.`, "ai");

}
function deriveSubjectFromFilename(fileName) {
  
  let base = fileName.replace(/\.[^/.]+$/, "");
  
  base = base.replace(/[_-]+/g, " ").trim();

  const lower = base.toLowerCase();
  let cutIndex = lower.length;

  
  const keywords = ["chapter", "chap", "lec", "lecture", "class", "week", "session", "slide"];
  keywords.forEach((kw) => {
    const idx = lower.indexOf(kw);
    if (idx !== -1 && idx < cutIndex) cutIndex = idx;
  });

  
  const digitIdx = lower.search(/\d/);
  if (digitIdx !== -1 && digitIdx < cutIndex) cutIndex = digitIdx;

  base = base.slice(0, cutIndex).trim();
  if (!base) base = fileName.replace(/\.[^/.]+$/, "").trim();

  
  return base
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

async function autoCreateCourseFromFile(file) {
  // Only when logged in and NO course is selected yet
  if (!currentUser || selectedCourseId) return;

  const subjectName = deriveSubjectFromFilename(file.name);

  
  const existing = courses.find(
    (c) => c.name && c.name.toLowerCase() === subjectName.toLowerCase()
  );
  if (existing) {
    setSelectedCourse(existing.id);
    appendMessage(
      `📚 Using existing course "${existing.name}" for this lecture.`,
      "ai"
    );
    return;
  }

  
  const payload = {
    name: subjectName, // e.g. "History", "Physics"
    subject: null,
  };

  try {
    const res = await fetch("/api/courses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      appendMessage(
        `⚠️ Could not auto-create course: ${data.detail || "unknown error"}`,
        "ai"
      );
      return;
    }

    courses.push(data);
    populateCourseSelect();
    setSelectedCourse(data.id);

    appendMessage(
      `📚 Created course "${data.name}" for this subject. Future "${data.name}" lectures will be saved here.`,
      "ai"
    );
  } catch (err) {
    console.error("autoCreateCourseFromFile error:", err);
  }
}



function setSelectedCourse(id) {
  if (!id) {
    selectedCourseId = null;
    localStorage.removeItem("als_course_id");
  } else {
    selectedCourseId = Number(id);
    localStorage.setItem("als_course_id", selectedCourseId);
  }
  if (courseSelect.value !== String(selectedCourseId || "")) {
    courseSelect.value = String(selectedCourseId || "");
  }
  fetchSummaries();
}

async function fetchSummaries() {
  if (!currentUser || !selectedCourseId) {
    savedSummaries = [];
    renderSummaryList();
    return;
  }
  const res = await fetch(`/api/summaries?course_id=${selectedCourseId}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) {
    savedSummaries = [];
    renderSummaryList();
    return;
  }
  savedSummaries = await res.json();
  renderSummaryList();
}

function renderSummaryList() {
  summaryList.innerHTML = "";
  if (!currentUser) {
    summaryEmpty.classList.remove("hidden");
    summaryEmpty.textContent =
      "Log in and select a course to save and view summaries.";
    return;
  }



  if (!savedSummaries.length) {
    summaryEmpty.classList.remove("hidden");
    summaryEmpty.textContent = selectedCourseId
      ? "No summaries saved for this course yet."
      : "Pick a course to see saved summaries.";
    return;
  }
  summaryEmpty.classList.add("hidden");
  savedSummaries.forEach((summary) => {
    const li = document.createElement("li");
    const date = new Date(summary.created_at).toLocaleString();
    li.innerHTML = `<strong>${escapeHtml(summary.title || "Untitled deck")}</strong><br><span>${date}</span>`;
    li.onclick = () => showSummaryInChat(summary);
    summaryList.appendChild(li);
  });
}

function showSummaryInChat(summary) {
  messagesDiv.innerHTML = "";
  appendMessage(`📚 Saved summary: ${summary.title || "Untitled deck"}`, "ai");
  const slides = summary.slides_payload || [];
  slides.forEach((slide) => {
    renderSlideCard(slide.page ?? "-", slide.title, slide.bullets || []);
  });
}

async function persistSummary(sessionIdValue, slides, fileName) {
  if (!currentUser || !selectedCourseId) return;
  const payload = {
    course_id: selectedCourseId,
    session_id: sessionIdValue,
    source_filename: fileName,
    title: slides[0]?.title || fileName,
    slides_payload: slides,
  };
  const res = await fetch("/api/summaries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    appendMessage(`⚠️ Failed to save summary: ${data.detail || "unknown error"}`, "ai");
    return;
  }
  appendMessage(`💾 Saved summary to course "${courses.find((c) => c.id === selectedCourseId)?.name || ""}".`, "ai");
  await fetchSummaries();
}

async function sendToBackend({ message, file }) {
  const formData = new FormData();
  formData.append("message", message || "Summarize this presentation");

  if (sessionId) formData.append("session_id", sessionId);
  if (file) formData.append("file", file);
  if (selectedCourseId) formData.append("course_id", selectedCourseId);

  const headers = {};
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    body: formData,
    headers,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Server error (${res.status}): ${txt || "no details"}`);
  }

  const data = await res.json();

  if (data.session_id) {
    sessionId = data.session_id;
  }

  const text = data.response || data.summary || "(no response)";
  const usedSlides = data.used_slides || [];

  return { text, usedSlides };
}



fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;

  if (selectedCourseId && !currentUser) {
    appendMessage("⚠️ Login required to save to a course.", "ai");
    return;
  }
  if (currentUser && !selectedCourseId) {
    await autoCreateCourseFromFile(file);
  }

  setProgress(5, "Uploading & extracting slides…");
  const form1 = new FormData();
  form1.append("file", file);
  const r1 = await fetch("/api/extract", { method: "POST", body: form1 });
  const d1 = await r1.json();
  if (d1.error) {
    renderSlideCard("-", "Error", [d1.error]);
    fileInput.value = "";
    return;
  }
  sessionId = d1.session_id;
  const slides = d1.slides || [];
  messagesDiv.innerHTML = "";

  const total = slides.length || 1;
  for (let i = 0; i < slides.length; i++) {
    setProgress(Math.round(((i + 1) / total) * 100), `Summarizing slide ${i + 1}/${total}…`);
    const s = slides[i];
    const form2 = new FormData();
    form2.append("session_id", sessionId);
    form2.append("page", s.page);
    form2.append("title", s.title || "");
    form2.append("text", s.text || "");
    const r2 = await fetch("/api/summarize/slide", { method: "POST", body: form2 });
    const d2 = await r2.json();
    slides[i].bullets = d2.bullets || [];
    renderSlideCard(d2.page, d2.title, d2.bullets || []);
  }
  setProgress(100, "Done");
  const hint =
    "✅ Presentation summarized!\n\n" +
    "You can now ask things like:\n" +
    "• Explain slide 3\n" +
    "• What is the main idea of this lecture?\n" +
    "• Compare slide 2 and 5\n" +
    "• Give me a quick recap of the whole lecture";
  appendMessage(hint, "ai"); 
  saveMessage(hint, "ai");
  appendMessage(`
    <div style="margin-top: 12px;">
      <button class="generateAssignmentBtn chat-btn">Generate Assignment</button>
      <button class="generateQuizBtn chat-btn">Generate Quiz</button>
    </div>
  `, "ai", true);

  saveMessage(hint, "ai");
  if (currentChat.title === "New Chat") {
    const baseName = file.name.replace(/\.pptx$/i, "");
    currentChat.title = `Deck: ${baseName}`;
    refreshChatList();
    await refreshAuthState();
    await fetchCourses();   // <- Required so autoCreateCourseFromFile works
    updateAuthUI();

  }

  if (currentUser && selectedCourseId) {
    await persistSummary(sessionId, slides, file.name);
  }
  
  fileInput.value = "";
});





async function sendMessage() {
  const message = userInput.value.trim();
  const file = null;

  if (!message) return;

  
  const lower = message.toLowerCase();
  if (
    lower.includes("generate assignment") ||
    lower.includes("generate quiz")
  ) {
    return;
  }

  if (!sessionId) {
    appendMessage("⚠️ Upload a PPTX first to ask follow-up questions.", "ai");
    return;
  }

  appendMessage(message, "user");
  saveMessage(message, "user");
  userInput.value = "";

  try {
    const { text, usedSlides } = await sendToBackend({ message, file });
    appendMessage(text, "ai");
    saveMessage(text, "ai");

    if (Array.isArray(usedSlides) && usedSlides.length > 0) {
      highlightSlides(usedSlides);
    }

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



signupBtn.addEventListener("click", async () => {
  if (!isSignupMode) {
    isSignupMode = true;
    authNameInput.style.display = "block";
    authNameInput.focus();
    return;
  }

  await registerUser();
});

loginBtn.addEventListener("click", async () => {
  isSignupMode = false;
  authNameInput.style.display = "none";
  await loginUser();
});

logoutBtn.addEventListener("click", logoutUser);
createCourseBtn.addEventListener("click", handleCreateCourse);
courseSelect.addEventListener("change", () => {
    setSelectedCourse(courseSelect.value);
    loadAssignments(selectedCourseId);
    loadQuizzes(selectedCourseId);
});

newChatBtn.addEventListener("click", () => {
  currentChat = { id: Date.now(), title: "New Chat", messages: [] };
  sessionId = null;
  messagesDiv.innerHTML = "";
});

sendBtn.addEventListener("click", sendMessage);
userInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});
themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  const mode = document.body.classList.contains("dark") ? "dark" : "light";
  localStorage.setItem("als_theme", mode);
});

async function init() {
  await refreshAuthState();
  await fetchCourses();
  updateAuthUI();
  refreshChatList();
}

init();


