from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from .utils import extract_text_by_slide, create_session, get_session
from .summarize import summarize_slide          # ✅ fixed import
from .qa_model import answer_question

app = FastAPI(title="AI Lecture Chat Summarizer")

# Serve /static and /
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/static", StaticFiles(directory=frontend_path), name="static")

@app.get("/")
async def serve_home():
    return FileResponse(os.path.join(frontend_path, "index.html"))

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/chat")
async def chat_endpoint(
    message: str = Form(...),
    session_id: str | None = Form(None),
    file: UploadFile | None = File(None)
):
    # --- Case 1: New PPTX upload ---
    if file:
        if not file.filename.lower().endswith(".pptx"):
            return {"error": "Please upload a .pptx file"}

        slides = extract_text_by_slide(file.file)
        all_sections = []
        for slide in slides:
            bullets = summarize_slide(slide["text"], ratio=0.55)
            section = f"🧾 **Slide {slide['page']}: {slide['title']}**\n{bullets}"
            all_sections.append(section)

        final_summary  = "\n\n".join(all_sections)
        full_text      = "\n".join(s["text"] for s in slides)
        new_session_id = create_session(full_text, final_summary)
        return {
            "response": "✅ Presentation summarized slide by slide!",
            "summary":  final_summary,
            "session_id": new_session_id,
        }
@app.post("/api/extract")
async def extract_endpoint(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pptx"):
        return {"error": "Please upload a .pptx file"}
    slides = extract_text_by_slide(file.file)
    # Create a session with empty summary for now; we'll build it per slide
    sid = create_session(" ".join(s["text"] for s in slides), "")
    # Return only what the client needs to render & loop
    return {
        "session_id": sid,
        "slides": [{"page": s["page"], "title": s["title"], "text": s["text"]} for s in slides]
    }

@app.post("/api/summarize/slide")
async def summarize_one(
    session_id: str = Form(...),
    page: int = Form(...),
    title: str = Form(""),
    text: str = Form(...)
):
    bullets = summarize_slide(text, ratio=0.65, max_bullets=10)  # larger summary
    sess = get_session(session_id)
    if sess is not None:
        section = f"🧾 **Slide {page}: {title}**\n" + "\n".join(f"• {b}" for b in bullets)
        sess["summary"] = (sess["summary"] + "\n\n" if sess["summary"] else "") + section
    return {"page": page, "title": title, "bullets": bullets}
    # --- Case 2: Follow‑up chat ---
    if not session_id:
        return {"error": "Session not found. Upload a PPTX first."}

    session = get_session(session_id)
    if not session:
        return {"error": "Invalid session ID."}

    normalized_msg = message.lower().strip()
    summary_triggers = [
        "show summary", "show the summary", "give me the summary",
        "presentation summarize", "whole summary", "show me what you summarized",
        "show summarization"
    ]
    if any(t in normalized_msg for t in summary_triggers):
        return {"response": session["summary"], "session_id": session_id}

    # Q&A using the stored summary as context
    context = session["summary"]
    answer  = answer_question(context, message)
    session["chat_history"].append({"user": message, "ai": answer})
    return {"response": answer, "session_id": session_id}
