# backend/summarize.py
import re
from transformers import pipeline, AutoTokenizer

MODEL = "sshleifer/distilbart-cnn-12-6"
tokenizer = AutoTokenizer.from_pretrained(MODEL, use_fast=True)
summarizer = pipeline("summarization", model=MODEL, tokenizer=tokenizer)

SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")
CONTROL_CHARS = re.compile(r"[\u200B-\u200D\uFEFF\x00-\x1F\x7F]")

def _normalize(text: str) -> str:
    text = CONTROL_CHARS.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()

def _to_bullets(text: str, max_items: int) -> list[str]:
    sents = [s.strip("•-—–· \t") for s in SENT_SPLIT.split(text) if s.strip()]
    # Drop tiny fragments & dedupe
    bullets, seen = [], set()
    for s in sents:
        if len(s.split()) < 6:        # avoid fragments
            continue
        k = s.lower()
        if k in seen:
            continue
        seen.add(k)
        bullets.append(s)
        if len(bullets) >= max_items:
            break
    return bullets or ([text] if text else [])

def summarize_slide(text: str, ratio: float = 0.65, max_bullets: int = 10) -> list[str]:
    """
    Summarize one slide to ≈ ratio of the input (by words) and return 5–10 clean bullets.
    ratio=0.65 means ~65% of original length → larger summaries as requested.
    """
    text = _normalize(text)
    if not text:
        return ["⚠️ No readable text found on this slide."]

    # Count words & tokens once
    words = len(text.split())
    if words < 25:
        # Too short to summarize; return as one bullet
        return [text]

    enc = tokenizer(text, add_special_tokens=False, return_attention_mask=False)
    input_tokens = len(enc["input_ids"])

    # Target words ≈ 65% of input (bounded)
    target_words = max(40, min(int(words * ratio), 220))
    # rough token estimate (1 word ≈ 1.3 tokens), never exceed input
    approx_max_tok = int(target_words * 1.3)
    max_len = min(max(30, approx_max_tok), int(input_tokens * 0.9))
    min_len = max(20, int(max_len * 0.75))
    if min_len >= max_len:
        min_len = max(12, int(max_len * 0.6))

    out = summarizer(
        text,
        max_length=max_len,
        min_length=min_len,
        no_repeat_ngram_size=3,
        num_beams=4,
        do_sample=False,
        length_penalty=1.05,   # slightly favor longer
        early_stopping=True,
    )[0]["summary_text"].strip()

    return _to_bullets(out, max_items=max_bullets)
