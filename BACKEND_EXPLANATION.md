# Backend Code Explanation for AI Lecture Summarizer

This document explains the entire backend codebase, organized by file and functionality.

---

## 📁 **File Structure Overview**

The backend consists of 4 main Python files:
1. **`app.py`** - Main FastAPI application with all API endpoints
2. **`utils.py`** - Utility functions for PPTX extraction and session management
3. **`summarize.py`** - AI-powered slide summarization
4. **`qa_model.py`** - Question-answering and explanation generation

---

## 🔧 **1. app.py - Main Application**

This is the core FastAPI application that handles all HTTP requests and routes.

### **Imports & Setup (Lines 1-12)**
```python
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
```
- **FastAPI**: Web framework for building APIs
- **CORS Middleware**: Allows frontend to communicate with backend from different origins
- Imports utility functions from other modules

### **Helper Functions (Lines 16-84)**

#### **`extract_slide_number(message: str)` (Lines 19-48)**
**Purpose**: Extracts slide numbers from user messages like "slide 11", "whats on slide 11", etc.

**How it works**:
1. Uses regex pattern to find "slide" or "page" followed by a number
2. Tries primary pattern first: `(?:slide|page)\s*(?:no\.?|number|#)?\s*[:.-]?\s*(\d{1,3})`
3. Falls back to a more flexible pattern if first fails
4. Returns the slide number (1-999) or `None`

**Example**: "whats on slide 11" → returns `11`

---

#### **`pick_relevant_slides(question, slides, k=3)` (Lines 50-65)**
**Purpose**: Finds the most relevant slides for a user's question using keyword matching.

**How it works**:
1. Extracts all words from the question
2. For each slide, counts how many question words appear in the slide's title, bullets, and text
3. Scores slides based on word overlap
4. Returns top `k` slides (default: 3) with score > 0

**Use case**: When user asks "What is environment?", it finds slides containing "environment" keyword

---

#### **`clean_slide_text(text: str)` (Lines 67-84)**
**Purpose**: Formats slide text for better readability.

**What it does**:
1. Replaces bullet symbols (•, ◦, etc.) with "- "
2. Normalizes whitespace
3. Adds line breaks after sentences
4. Formats bullet points

---

### **FastAPI App Initialization (Lines 87-105)**

#### **CORS Middleware (Lines 90-96)**
```python
app.add_middleware(CORSMiddleware, allow_origins=["*"], ...)
```
**Purpose**: Allows frontend (running on different port) to make requests to backend
- `allow_origins=["*"]`: Accepts requests from any origin
- `allow_methods=["*"]`: Allows all HTTP methods (GET, POST, etc.)

#### **Static Files (Line 99)**
```python
app.mount("/static", StaticFiles(directory=frontend_path), name="static")
```
**Purpose**: Serves frontend files (HTML, CSS, JS) from the `/static` route

#### **Home Route (Lines 101-103)**
```python
@app.get("/")
async def serve_home():
    return FileResponse(os.path.join(frontend_path, "index.html"))
```
**Purpose**: Returns the main HTML page when user visits the root URL

---

### **API Endpoints**

#### **1. `/api/extract` (POST) - Lines 109-124**
**Purpose**: Extracts text from uploaded PowerPoint file

**Flow**:
1. Validates file is `.pptx` format
2. Calls `extract_text_by_slide()` to get all slide content
3. Creates a new session with extracted slides
4. Returns session ID and slide list

**Request**: `file: UploadFile`
**Response**: `{session_id, slides: [{page, title, text}]}`

**Use case**: Frontend uploads a PPTX file, backend extracts all text and creates a session

---

#### **2. `/api/summarize/slide` (POST) - Lines 126-143**
**Purpose**: Summarizes a single slide into bullet points

**Flow**:
1. Receives slide data (session_id, page, title, text)
2. Calls `summarize_slide()` to generate bullet points
3. Updates the session with bullets
4. Adds to session's summary text

**Request**: `session_id, page, title, text`
**Response**: `{page, title, bullets: [...]}`

**Use case**: After extraction, frontend calls this for each slide to create summaries

---

#### **3. `/api/chat` (POST) - Lines 147-251** ⭐ **MAIN ENDPOINT**
**Purpose**: Handles all chat interactions - file uploads, slide lookups, and Q&A

**This endpoint has 4 main sections:**

##### **Section 1: File Upload Handling (Lines 153-182)**
- **When**: User uploads a file via chat
- **What it does**:
  1. Validates `.pptx` file
  2. Extracts all slides
  3. Summarizes each slide (if text > 12 words)
  4. Creates a new session with all slides and summaries
  5. Returns complete summary

##### **Section 2: Session Validation (Lines 184-189)**
- Checks if `session_id` exists
- Retrieves session data
- Returns error if session invalid

##### **Section 3: Direct Slide Lookup (Lines 191-226)** 🎯
- **When**: User asks for specific slide (e.g., "slide 11")
- **What it does**:
  1. Extracts slide number from message using `extract_slide_number()`
  2. Finds the slide in session
  3. **Generates AI explanation** using `explain_slide()` (not just raw text!)
  4. Returns formatted explanation with slide title
- **Special cases**:
  - If slide not found: Returns error message
  - If slide empty: Returns appropriate message

##### **Section 4: Intelligent Q&A (Lines 228-251)**
- **When**: User asks general questions (not specific slide)
- **What it does**:
  1. Uses `pick_relevant_slides()` to find top 3 relevant slides
  2. If relevant slides found: Uses their text as context
  3. If no relevant slides: Falls back to summary (if < 3000 chars)
  4. Calls `answer_question()` with context and question
  5. Returns AI-generated answer

**Request**: `message, session_id (optional), file (optional)`
**Response**: `{response, session_id}`

---

#### **4. `/api/debug/session/{session_id}` (GET) - Lines 255-267**
**Purpose**: Debug endpoint to view session data

**Returns**:
- Preview of PPTX text (first 1000 chars)
- Full summary
- Slide count
- All slides data
- Chat history

**Use case**: Testing and debugging - see what's stored in a session

---

#### **5. `/api/debug/sessions` (GET) - Lines 270-273**
**Purpose**: Lists all active session IDs

**Returns**: `{sessions: [session_id1, session_id2, ...]}`

**Use case**: See how many active sessions exist

---

## 🔧 **2. utils.py - Utility Functions**

### **Global Variables**
- **`sessions` (Line 7)**: In-memory dictionary storing all session data
  - Key: `session_id` (UUID string)
  - Value: `{pptx_text, summary, slides, chat_history}`

- **`FOOTER_PATTERNS` (Lines 9-14)**: Regex patterns to detect footers/headers
  - URLs, emails, copyright notices, etc.
  - Used to filter out repeated footer text from slides

---

### **Functions**

#### **`_clean_lines(lines: list[str])` (Lines 17-32)**
**Purpose**: Cleans and filters text lines from slides

**What it does**:
1. Removes invisible/control characters
2. Normalizes whitespace
3. Filters out bare slide numbers ("12", "Slide 12")
4. Removes footer patterns (URLs, emails, copyright)

**Why**: PowerPoint files often have repeated footers on every slide - this removes them

---

#### **`extract_text_by_slide(file)` (Lines 34-78)** ⭐ **CORE FUNCTION**
**Purpose**: Extracts all text content from a PowerPoint file, slide by slide

**How it works**:

1. **Parse PowerPoint** (Line 35):
   ```python
   prs = Presentation(file)
   ```

2. **First Pass - Collect Raw Text** (Lines 38-61):
   - Iterates through each slide
   - For each shape on slide:
     - **Text frames**: Extracts text from titles, bullets, placeholders
     - **Tables**: Extracts text from table cells
     - **Grouped shapes**: Recursively extracts from nested shapes
   - Stores all text lines per slide

3. **Second Pass - Remove Common Footers** (Lines 63-67):
   - Collects all text lines from all slides
   - Finds text that appears on ≥3 slides (common footers/headers)
   - Creates a set of "common" text to filter out

4. **Third Pass - Structure Data** (Lines 69-77):
   - For each slide:
     - Cleans lines using `_clean_lines()`
     - Removes common footer text
     - First line = title
     - Remaining lines = body text
   - Returns list of `{page, title, text}` dictionaries

**Returns**: `[{page: 1, title: "...", text: "..."}, ...]`

---

#### **`create_session(pptx_text, summary_text, slides_payload)` (Lines 80-89)**
**Purpose**: Creates a new session and stores it in memory

**What it does**:
1. Generates unique UUID for session ID
2. Stores session data in `sessions` dictionary:
   - `pptx_text`: All text from presentation (concatenated)
   - `summary`: Formatted summary with bullet points
   - `slides`: List of slide dictionaries with text and bullets
   - `chat_history`: Empty list (will store conversation)
3. Returns session ID

**Note**: Sessions are stored in-memory (lost on server restart)

---

#### **`get_session(session_id)` (Lines 91-92)**
**Purpose**: Retrieves session data by ID

**Returns**: Session dictionary or `None` if not found

---

## 🤖 **3. summarize.py - AI Summarization**

### **Model Setup (Lines 5-7)**
```python
MODEL = "sshleifer/distilbart-cnn-12-6"
summarizer = pipeline("summarization", model=MODEL, tokenizer=tokenizer)
```
- **Model**: DistilBART (lightweight BART model for summarization)
- **Purpose**: Converts long slide text into concise summaries

---

### **Helper Functions**

#### **`_normalize(text: str)` (Lines 12-14)**
**Purpose**: Cleans text before summarization
- Removes control characters
- Normalizes whitespace

#### **`_to_bullets(text: str, max_items: int)` (Lines 16-30)**
**Purpose**: Converts summarized text into bullet points

**How it works**:
1. Splits text into sentences
2. Filters out:
   - Sentences with < 6 words (too short)
   - Duplicate sentences
3. Returns up to `max_items` bullets

---

### **Main Function: `summarize_slide(text, ratio=0.65, max_bullets=10)` (Lines 32-67)**

**Purpose**: Summarizes slide text into bullet points using AI

**Flow**:

1. **Validation** (Lines 34-42):
   - Normalizes text
   - If text < 25 words: Returns text as single bullet (too short to summarize)

2. **Calculate Summary Length** (Lines 44-54):
   - Counts input tokens
   - Calculates target length: `words * ratio` (default: 65% of original)
   - Sets `max_length` and `min_length` for AI model
   - Ensures reasonable bounds (not too short/long)

3. **Generate Summary** (Lines 56-65):
   - Calls DistilBART model with:
     - `max_length`: Maximum tokens in summary
     - `min_length`: Minimum tokens
     - `num_beams=4`: Beam search for better quality
     - `no_repeat_ngram_size=3`: Prevents repetition
   - Gets summarized text

4. **Convert to Bullets** (Line 67):
   - Calls `_to_bullets()` to format as list

**Returns**: `["bullet point 1", "bullet point 2", ...]`

**Example**:
- Input: Long paragraph about environment
- Output: `["Environment includes biotic and abiotic factors", "Natural environment has living and non-living components", ...]`

---

## 💬 **4. qa_model.py - Question Answering & Explanations**

### **Model Setup (Line 4)**
```python
qa_model = pipeline("text2text-generation", model="google/flan-t5-base")
```
- **Model**: FLAN-T5 (instruction-tuned T5 model)
- **Purpose**: Answers questions and generates explanations

---

### **Functions**

#### **`answer_question(context, question)` (Lines 6-9)**
**Purpose**: Answers questions based on provided context

**How it works**:
1. Creates prompt: `"Answer based only on the following context:\n\n{context}\n\nQuestion: {question}"`
2. Calls FLAN-T5 model with `max_length=150` (short answers)
3. Returns generated answer

**Use case**: General Q&A about presentation content

---

#### **`explain_slide(context, prompt)` (Lines 11-15)** ⭐ **NEW FEATURE**
**Purpose**: Generates detailed explanations of slide content

**How it works**:
1. Creates prompt with slide context (title + content)
2. Uses custom prompt asking for detailed explanation
3. Calls FLAN-T5 with `max_length=300` (longer output than Q&A)
4. Returns detailed explanation

**Use case**: When user asks "slide 11", returns explanation instead of raw text

**Key difference from `answer_question()`**:
- Longer output (300 vs 150 tokens)
- More detailed, explanatory style
- Specifically for slide explanations

---

## 🔄 **Complete Request Flow Example**

### **Scenario: User asks "whats on slide 11"**

1. **Frontend** sends POST to `/api/chat`:
   ```json
   {
     "message": "whats on slide 11",
     "session_id": "abc-123-..."
   }
   ```

2. **Backend** (`app.py`):
   - Validates session exists
   - Calls `extract_slide_number("whats on slide 11")` → returns `11`
   - Finds slide 11 in session
   - Gets slide's raw text content

3. **AI Explanation** (`qa_model.py`):
   - Calls `explain_slide()` with slide context
   - FLAN-T5 generates detailed explanation
   - Returns explanation text

4. **Response**:
   ```json
   {
     "response": "📑 **Slide 11: Segments with several factors:**\n\n[AI-generated explanation...]",
     "session_id": "abc-123-..."
   }
   ```

5. **Frontend** displays formatted explanation

---

## 🎯 **Key Design Decisions**

1. **In-Memory Sessions**: Simple, fast, but lost on restart (good for demo)
2. **Two AI Models**:
   - DistilBART: For summarization (specialized)
   - FLAN-T5: For Q&A and explanations (general purpose)
3. **Slide Number Extraction**: Regex-based, handles various formats
4. **Relevant Slide Search**: Keyword-based (simple but effective)
5. **Summary Fallback**: Only uses full summary if < 3000 chars (prevents AI confusion)

---

## 📊 **Data Structures**

### **Session Structure**
```python
{
  "pptx_text": "all text concatenated...",
  "summary": "🧾 **Slide 1: ...**\n• bullet 1\n...",
  "slides": [
    {
      "page": 1,
      "title": "Slide Title",
      "text": "Raw slide text...",
      "bullets": ["bullet 1", "bullet 2", ...]
    },
    ...
  ],
  "chat_history": [
    {"user": "slide 11", "ai": "📑 **Slide 11: ..."},
    ...
  ]
}
```

---

## 🚀 **Summary for Supervisor**

**What this backend does**:
1. **Extracts** text from PowerPoint files (slide by slide)
2. **Summarizes** each slide using AI (DistilBART)
3. **Stores** everything in sessions (in-memory)
4. **Handles** three types of user queries:
   - Specific slide requests → Returns AI explanation
   - General questions → Finds relevant slides, answers with AI
   - File uploads → Processes and creates new session

**Technologies**:
- FastAPI (web framework)
- Transformers (Hugging Face AI models)
- python-pptx (PowerPoint parsing)

**AI Models Used**:
- DistilBART: Summarization
- FLAN-T5: Question answering and explanations

