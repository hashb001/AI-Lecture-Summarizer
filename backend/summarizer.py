from transformers import pipeline

summarizer=pipeline("summarization", model="sshleifer/distilbart-cnn-12-6")

def summarize_text(text:str, max_chunk_len: int =800) -> str:
    chunks= []
    while len(text)> max_chunk_len:
        split_at = text[:max_chunk_len].rfind(". ")
        if split_at == -1:
            split_at = max_chunk_len
        chunks.append(text[:split_at + 1])
        text = text [:split_at + 1:]
    chunks.append(text)

    summaries = []
    for chunk in chunks:
        result = summarizer(chunk, max_length=150, min_length=40, do_sample=False)
        summaries.append(result[0]["summary_text"].strip())

    return " ".join(summaries)