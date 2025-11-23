# Backend Code Summary - Quick Reference

## 📋 **Overview**
The backend is a FastAPI application that processes PowerPoint files, extracts text, summarizes slides using AI, and answers user questions.

---

## 🗂️ **4 Main Files**

### **1. app.py** - Main Application
- **FastAPI server** with 5 API endpoints
- Handles file uploads, chat messages, slide lookups
- Routes requests to appropriate functions

### **2. utils.py** - Core Utilities
- **`extract_text_by_slide()`**: Extracts text from PowerPoint files
- **`create_session()`**: Creates and stores session data
- **`get_session()`**: Retrieves session data

### **3. summarize.py** - AI Summarization
- Uses **DistilBART** model to summarize slide text
- Converts long text into concise bullet points

### **4. qa_model.py** - AI Q&A & Explanations
- Uses **FLAN-T5** model for:
  - Answering questions (`answer_question()`)
  - Explaining slides (`explain_slide()`)

---

## 🔄 **Main Workflow**

### **1. File Upload Flow**
```
User uploads PPTX 
  → extract_text_by_slide() extracts all text
  → summarize_slide() creates bullet points for each slide
  → create_session() stores everything
  → Returns session_id and slides
```

### **2. Chat Flow**
```
User asks "slide 11"
  → extract_slide_number() finds "11"
  → Gets slide 11 from session
  → explain_slide() generates AI explanation
  → Returns formatted explanation
```

### **3. Q&A Flow**
```
User asks "What is environment?"
  → pick_relevant_slides() finds top 3 relevant slides
  → answer_question() generates answer using AI
  → Returns answer
```

---

## 🎯 **Key Functions**

| Function | File | Purpose |
|----------|------|---------|
| `extract_text_by_slide()` | utils.py | Extracts text from PPTX |
| `summarize_slide()` | summarize.py | Creates bullet summaries |
| `extract_slide_number()` | app.py | Finds slide number in message |
| `pick_relevant_slides()` | app.py | Finds relevant slides for question |
| `answer_question()` | qa_model.py | Answers questions with AI |
| `explain_slide()` | qa_model.py | Explains slide content with AI |

---

## 🤖 **AI Models Used**

1. **DistilBART** (`sshleifer/distilbart-cnn-12-6`)
   - Purpose: Summarization
   - Input: Long slide text
   - Output: Short summary

2. **FLAN-T5** (`google/flan-t5-base`)
   - Purpose: Q&A and explanations
   - Input: Context + question/prompt
   - Output: Answer or explanation

---

## 📡 **API Endpoints**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Serves frontend HTML |
| `/api/extract` | POST | Extracts text from PPTX |
| `/api/summarize/slide` | POST | Summarizes one slide |
| `/api/chat` | POST | Main chat endpoint (handles everything) |
| `/api/debug/session/{id}` | GET | View session data (debug) |
| `/api/debug/sessions` | GET | List all sessions (debug) |

---

## 💾 **Data Storage**

**Sessions** (in-memory dictionary):
```python
sessions = {
  "session-id-1": {
    "pptx_text": "all text...",
    "summary": "formatted summary...",
    "slides": [{page, title, text, bullets}, ...],
    "chat_history": [{user, ai}, ...]
  }
}
```

---

## 🔍 **How Slide Lookup Works**

1. User: "whats on slide 11"
2. `extract_slide_number()` → finds "11"
3. Gets slide 11 from session
4. `explain_slide()` → AI generates explanation
5. Returns: "📑 **Slide 11: Title**\n\n[Explanation...]"

---

## 🎓 **For Your Supervisor**

**What to say:**
- "The backend uses FastAPI to handle HTTP requests"
- "It extracts text from PowerPoint files using python-pptx library"
- "Two AI models: DistilBART for summarization, FLAN-T5 for Q&A"
- "Sessions store all data in-memory (simple but temporary)"
- "Main endpoint `/api/chat` handles 3 cases: file uploads, specific slide requests, and general questions"
- "When user asks for a slide, AI generates an explanation instead of just showing raw text"

