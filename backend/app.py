from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from typing import Optional
import os
import re

from .utils import extract_text_by_slide, create_session, get_session, sessions
from .summarize import summarize_slide          
from .qa_model import answer_question, explain_slide          
import logging

# -------------------------------

# More flexible regex to catch patterns like "slide 11", "whats on slide 11", "show slide 11", etc.
SLIDE_RX = re.compile(r"(?:slide|page)\s*(?:no\.?|number|#)?\s*[:.-]?\s*(\d{1,3})", re.I)

def extract_slide_number(message: str) -> int | None:
    """Extract slide number from message. Handles various formats like 'slide 11', 'whats on slide 11', etc."""
    if not message:
        return None
    
    txt = message.lower()
   
    # Try the main pattern first
    m = SLIDE_RX.search(txt)
    if m:
        try:
            n = int(m.group(1))
            return n if 1 <= n <= 999 else None
        except ValueError:
            pass
    
    # Fallback: look for standalone numbers after "slide" or "page" keywords
    # This catches cases where there might be extra words between "slide" and the number
    fallback_pattern = re.compile(r"(?:slide|page).*?(\d{1,3})", re.I)
    m = fallback_pattern.search(txt)
    if m:
        try:
            n = int(m.group(1))
            # Only return if it's a reasonable slide number (1-999)
            if 1 <= n <= 999:
                return n
        except ValueError:
            pass
    
    return None

def pick_relevant_slides(question: str, slides: list[dict], k: int = 3) -> list[dict]:
    
    q = question or ""
    q_words = set(re.findall(r"\b\w+\b", q.lower()))
    scored = []
    for s in slides:
        blob = " ".join([
            s.get("title", ""),
            " ".join(s.get("bullets", [])),
            s.get("text", "")
        ]).lower()
        words = set(re.findall(r"\b\w+\b", blob))
        score = len(q_words & words)
        scored.append((score, s))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [s for score, s in scored[:k] if score > 0]

def clean_slide_text(text: str) -> str:
   
    if not text: 
        return ""
    
   
    text = re.sub(r"[\u2022\u2023\u25E6\u2043\u2219]", "- ", text)
    
    
    text = re.sub(r"\s+", " ", text)
    
   
    text = re.sub(r"(\.)\s+([A-Z])", r"\1\n\2", text)
    
    
    text = re.sub(r"\s+-\s+", "\n- ", text)

    return text.strip()


app = FastAPI(title="AI Lecture Chat Summarizer")

# Add CORS middleware before routes
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/static", StaticFiles(directory=frontend_path), name="static")

@app.get("/")
async def serve_home():
    return FileResponse(os.path.join(frontend_path, "index.html"))

logging.basicConfig(level=logging.INFO)



@app.post("/api/extract")
async def extract_endpoint(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pptx"):
        return {"error": "Please upload a .pptx file"}

    slides = extract_text_by_slide(file.file)
    slides_payload = [
        {"page": s["page"], "title": s["title"], "text": s["text"], "bullets": []}
        for s in slides
    ]
    sid = create_session(" ".join(s["text"] for s in slides), "", slides_payload)

    return {
        "session_id": sid,
        "slides": [{"page": s["page"], "title": s["title"], "text": s["text"]} for s in slides]
    }

@app.post("/api/summarize/slide")
async def summarize_one(
    session_id: str = Form(...),
    page: int       = Form(...),
    title: str      = Form(""),
    text: str       = Form(...)
):
    bullets = summarize_slide(text, ratio=0.65, max_bullets=10)
    sess = get_session(session_id)
    if sess is not None:
        for sl in sess.setdefault("slides", []):
            if sl.get("page") == page:
                sl["bullets"] = bullets
                break
        section = f"🧾 **Slide {page}: {title}**\n" + "\n".join(f"• {b}" for b in bullets)
        sess["summary"] = (sess.get("summary", "") + ("\n\n" if sess.get("summary") else "") + section)

    return {"page": page, "title": title, "bullets": bullets}

# In backend/app.py

@app.post("/api/chat")
async def chat_endpoint(
    message: str = Form(...),
    session_id: Optional[str] = Form(default=None),
    file: Optional[UploadFile] = File(default=None)
):
    # 1. HANDLE FILE UPLOAD (Only if a file is actually provided)
    if file and file.filename: # check filename to ensure it's not an empty object
        if not file.filename.lower().endswith(".pptx"):
            return {"error": "Please upload a .pptx file"}
        
        slides_raw = extract_text_by_slide(file.file)
        slides_payload = []
        for s in slides_raw:
            txt = s["text"]
            if not txt or len(txt.split()) < 12:
                bullets = [s["title"]] if s["title"] else ["(No readable text)"]
            else:
                bullets = summarize_slide(txt, ratio=0.65, max_bullets=10)
            slides_payload.append({
                "page": s["page"], "title": s["title"], "text": s["text"], "bullets": bullets
            })
            
        final_summary = "\n\n".join(
            f"🧾 **Slide {sl['page']}: {sl['title']}**\n" + "\n".join(f"• {b}" for b in sl['bullets'])
            for sl in slides_payload
        )
        
        # Create new session
        new_session_id = create_session(" ".join(s["text"] for s in slides_raw), final_summary, slides_payload)
        return {
            "response": "✅ Presentation summarized! Ask me about any slide.",
            "slides": slides_payload, 
            "summary": final_summary, 
            "session_id": new_session_id
        }

    # 2. VALIDATE SESSION
    if not session_id:
        return {"error": "Session not found. Upload a PPTX first."}
    sess = get_session(session_id)
    if not sess:
        return {"error": "Invalid session ID."}

    # 3. DIRECT COMMANDS (Specific Slide Lookup)
    slide_num = extract_slide_number(message)
    slides = sess.get("slides", [])

    if slide_num:
        hit = next((s for s in slides if s["page"] == slide_num), None)
        if hit:
            # Always use raw text, never use bullets (bullets are summaries)
            content = hit.get("text", "").strip()
            
            if not content:
                # Only if there's absolutely no text, check bullets as last resort
                if hit.get("bullets"):
                    content = "\n".join(hit["bullets"])
                    # If we only have bullets, explain them but note they're a summary
                    slide_context = f"Title: {hit['title']}\n\nContent: {content}"
                    explanation_prompt = "Provide a detailed explanation of this slide content. Explain what it teaches, what the key concepts mean, and how they relate to each other. Elaborate on each point:"
                    explanation = explain_slide(slide_context, explanation_prompt)
                    response = f"📑 **Slide {hit['page']}: {hit['title']}**\n\n{explanation}"
                else:
                    response = f"📑 **Slide {hit['page']}: {hit['title']}**\n\n(This slide seems to be empty or contains only images.)"
            else:
                # Generate an explanation of the slide using AI with the raw text
                slide_context = f"Title: {hit['title']}\n\nContent: {content}"
                explanation_prompt = "Provide a detailed explanation of this slide. Explain what it teaches, what the key concepts mean, and how they relate to each other. Do not just summarize - explain and elaborate on the meaning and significance:"
                explanation = explain_slide(slide_context, explanation_prompt)
                response = f"📑 **Slide {hit['page']}: {hit['title']}**\n\n{explanation}"
            
            sess.setdefault("chat_history", []).append({"user": message, "ai": response})
            return {"response": response, "session_id": session_id}
        else:
             # If user asked for "Slide 99" but it doesn't exist, STOP HERE.
             # Do not fall through to the AI model.
            response = f"⚠️ Slide {slide_num} not found. This deck has {len(slides)} slides."
            sess.setdefault("chat_history", []).append({"user": message, "ai": response})
            return {"response": response, "session_id": session_id}

    # 4. INTELLIGENT SEARCH (Q&A)
    # Only runs if it wasn't a specific slide request
    context = ""
    if slides:
        top = pick_relevant_slides(message, slides, k=3)
        if top:
            context = "\n\n".join(
                f"Slide {s['page']}: {s['title']}\n" + s.get("text", "")
                for s in top
            )
    
    # If search failed, DO NOT just dump the whole summary. 
    # It confuses the AI. Instead, check if the summary is small enough to fit.
    if not context:
        summary_text = sess.get("summary", "")
        if len(summary_text) < 3000: # Only use full summary if it's short
            context = summary_text
        else:
            # Fallback: Can't find relevant info
            return {"response": "⚠️ I couldn't find specific information matching your question in the slides.", "session_id": session_id}

    ans = answer_question(context, message)
    sess.setdefault("chat_history", []).append({"user": message, "ai": ans})
    return {"response": ans, "session_id": session_id}



@app.get("/api/debug/session/{session_id}")
async def debug_session(session_id: str):
    sess = get_session(session_id)
    if not sess:
        return {"error": "session not found"}
    # return a lightweight view
    return {
        "pptx_text_preview": (sess.get("pptx_text") or "")[:1000],
        "summary": sess.get("summary"),
        "slides_count": len(sess.get("slides", [])),
        "slides": sess.get("slides", []),
        "chat_history": sess.get("chat_history", []),
    }


@app.get("/api/debug/sessions")
async def debug_sessions_list():
    # return current in-memory session ids (temporary)
    return {"sessions": list(sessions.keys())}