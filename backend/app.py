from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from typing import Optional
import os
import re
from sqlalchemy.orm import Session

from .utils import extract_text_by_slide, create_session, get_session, sessions
from .summarize import summarize_slide          
from .qa_model import answer_question, explain_slide          
import logging
from .database import Base, engine, get_db
from .models import Course, Summary, User
from .schemas import (
    CourseCreate,
    CourseOut,
    LoginRequest,
    SummaryCreate,
    SummaryOut,
    TokenResponse,
    UserCreate,
    UserOut,
)
from .auth import create_access_token, decode_access_token, get_password_hash, verify_password


SLIDE_RX = re.compile(r"(?:slide|page)\s*(?:no\.?|number|#)?\s*[:.-]?\s*(\d{1,3})", re.I)

def extract_slide_number(message: str) -> int | None:
    
    if not message:
        return None
    
    txt = message.lower()
   
    
    m = SLIDE_RX.search(txt)
    if m:
        try:
            n = int(m.group(1))
            return n if 1 <= n <= 999 else None
        except ValueError:
            pass
    
    
    fallback_pattern = re.compile(r"(?:slide|page).*?(\d{1,3})", re.I)
    m = fallback_pattern.search(txt)
    if m:
        try:
            n = int(m.group(1))
            
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


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
auth_scheme = HTTPBearer(auto_error=False)
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/static", StaticFiles(directory=frontend_path), name="static")

@app.get("/")
async def serve_home():
    return FileResponse(os.path.join(frontend_path, "index.html"))

logging.basicConfig(level=logging.INFO)
def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(auth_scheme),
    db: Session = Depends(get_db),
) -> User:
    return _resolve_user(credentials, db, required=True)

@app.post("/api/auth/register", response_model=UserOut)
def register_user(payload: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=payload.email,
        full_name=payload.full_name,
        password_hash=get_password_hash(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.post("/api/auth/login", response_model=TokenResponse)
def login_user(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_access_token({"sub": user.email, "uid": str(user.id)})
    return TokenResponse(access_token=token)


@app.post("/api/auth/logout")
def logout_user():
    # JWT-based auth: client simply discards the token.
    return {"detail": "Logged out"}


@app.get("/api/auth/me", response_model=UserOut)
def read_current_user(current_user: User = Depends(get_current_user)):
    return current_user


@app.get("/api/courses", response_model=list[CourseOut])
def list_courses(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    courses = db.query(Course).filter(Course.owner_id == current_user.id).order_by(Course.created_at.desc()).all()
    return courses


@app.post("/api/courses", response_model=CourseOut)
def create_course(
    payload: CourseCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    course = Course(
        owner_id=current_user.id,
        name=payload.name,
        subject=payload.subject,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


@app.post("/api/summaries", response_model=SummaryOut)
def save_summary(
    payload: SummaryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    course = (
        db.query(Course)
        .filter(Course.id == payload.course_id, Course.owner_id == current_user.id)
        .first()
    )
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    summary_text = payload.summary_text
    if not summary_text or not summary_text.strip():
        sess = get_session(payload.session_id) if payload.session_id else None
        summary_text = (sess or {}).get("summary", "")
    if not summary_text:
        raise HTTPException(status_code=400, detail="Missing summary text")

    summary = Summary(
        user_id=current_user.id,
        course_id=payload.course_id,
        session_id=payload.session_id,
        source_filename=payload.source_filename,
        title=payload.title,
        summary_text=summary_text,
        slides_payload=payload.slides_payload,
    )
    db.add(summary)
    db.commit()
    db.refresh(summary)
    return summary


@app.get("/api/summaries", response_model=list[SummaryOut])
def list_summaries(
    course_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Summary).filter(Summary.user_id == current_user.id)
    if course_id:
        query = query.filter(Summary.course_id == course_id)
    summaries = query.order_by(Summary.created_at.desc()).all()
    return summaries




@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)


def _resolve_user(credentials: HTTPAuthorizationCredentials, db: Session, *, required: bool):
    if not credentials:
        if required:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return None
    token = credentials.credentials
    try:
        payload = decode_access_token(token)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None
    email = payload.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user





def get_optional_user(
    credentials: HTTPAuthorizationCredentials = Depends(auth_scheme),
    db: Session = Depends(get_db),
) -> Optional[User]:
    return _resolve_user(credentials, db, required=False)


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



@app.post("/api/chat")
async def chat_endpoint(
    message: str = Form(...),
    session_id: Optional[str] = Form(default=None),
    course_id: Optional[int] = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
    current_user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    
    if course_id and not current_user:
        raise HTTPException(status_code=401, detail="Login required to save summaries")
    
    if file and file.filename: 
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
        
        
        new_session_id = create_session(" ".join(s["text"] for s in slides_raw), final_summary, slides_payload)
        saved_summary_id = None
        if current_user and course_id:
            course = (
                db.query(Course)
                .filter(Course.id == course_id, Course.owner_id == current_user.id)
                .first()
            )
            if not course:
                raise HTTPException(status_code=404, detail="Course not found")
            summary = Summary(
                user_id=current_user.id,
                course_id=course_id,
                session_id=new_session_id,
                source_filename=file.filename,
                title=slides_payload[0]["title"] if slides_payload else None,
                summary_text=final_summary,
                slides_payload=slides_payload,
            )
            db.add(summary)
            db.commit()
            db.refresh(summary)
            saved_summary_id = summary.id

        return {
            "response": "✅ Presentation summarized! Ask me about any slide.",
            "slides": slides_payload, 
            "summary": final_summary, 
            "session_id": new_session_id,
            "saved_summary_id": saved_summary_id,
        }

    
    if not session_id:
        return {"error": "Session not found. Upload a PPTX first."}
    sess = get_session(session_id)
    if not sess:
        return {"error": "Invalid session ID."}

    
    slide_num = extract_slide_number(message)
    slides = sess.get("slides", [])

    if slide_num:
        hit = next((s for s in slides if s["page"] == slide_num), None)
        if hit:
            
            content = hit.get("text", "").strip()
            title = hit.get("title", "")
            
            
            if not content or len(content.split()) < 10:
                if hit.get("bullets"):
                    combined_content = f"{title}\n\n" + "\n".join(hit["bullets"])
                    slide_context = f"Title: {title}\n\nContent: {combined_content}"
                    explanation_prompt = "Provide a detailed explanation of this slide content. Explain what it teaches, what the key concepts mean, and how they relate to each other. Elaborate on each point with examples and context:"
                    explanation = explain_slide(slide_context, explanation_prompt)
                    response = f"📑 **Slide {hit['page']}: {title}**\n\n{explanation}"
                elif not content:
                    response = f"📑 **Slide {hit['page']}: {title}**\n\n(This slide seems to be empty or contains only images.)"
                else:
                    
                    slide_context = f"Title: {title}\n\nContent: {title}\n{content}"
                    explanation_prompt = "Provide a detailed explanation of this slide. Explain what it teaches, what the key concepts mean, and how they relate to each other. Be thorough and detailed:"
                    explanation = explain_slide(slide_context, explanation_prompt)
                    response = f"📑 **Slide {hit['page']}: {title}**\n\n{explanation}"
            else:
                
                slide_context = f"Title: {title}\n\nContent: {content}"
                explanation_prompt = "Provide a detailed explanation of this slide. Explain what it teaches, what the key concepts mean, and how they relate to each other. Do not just summarize - explain and elaborate on the meaning and significance. Be thorough and detailed:"
                explanation = explain_slide(slide_context, explanation_prompt)
                response = f"📑 **Slide {hit['page']}: {title}**\n\n{explanation}"
            
            sess.setdefault("chat_history", []).append({"user": message, "ai": response})
            return {"response": response, "session_id": session_id}
        else:
             
            response = f"⚠️ Slide {slide_num} not found. This deck has {len(slides)} slides."
            sess.setdefault("chat_history", []).append({"user": message, "ai": response})
            return {"response": response, "session_id": session_id}

    
    context = ""
    if slides:
        top = pick_relevant_slides(message, slides, k=3)
        if top:
            context = "\n\n".join(
                f"Slide {s['page']}: {s['title']}\n" + s.get("text", "")
                for s in top
            )
    
    
    if not context:
        summary_text = sess.get("summary", "")
        if len(summary_text) < 3000: 
            context = summary_text
        else:
            
            return {"response": "⚠️ I couldn't find specific information matching your question in the slides.", "session_id": session_id}

    ans = answer_question(context, message)
    sess.setdefault("chat_history", []).append({"user": message, "ai": ans})
    return {"response": ans, "session_id": session_id}



@app.get("/api/debug/session/{session_id}")
async def debug_session(session_id: str):
    sess = get_session(session_id)
    if not sess:
        return {"error": "session not found"}
    return {
        "pptx_text_preview": (sess.get("pptx_text") or "")[:1000],
        "summary": sess.get("summary"),
        "slides_count": len(sess.get("slides", [])),
        "slides": sess.get("slides", []),
        "chat_history": sess.get("chat_history", []),
    }


@app.get("/api/debug/sessions")
async def debug_sessions_list():
    
    return {"sessions": list(sessions.keys())}