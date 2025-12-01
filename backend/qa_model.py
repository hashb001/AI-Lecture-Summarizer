
from transformers import pipeline

qa_model = pipeline("text2text-generation", model="google/flan-t5-base")

def answer_question(context: str, question: str) -> str:
    prompt = f"Answer based only on the following context:\n\n{context}\n\nQuestion: {question}"
    result = qa_model(prompt, max_length=150)
    return result[0]['generated_text']

def explain_slide(context: str, prompt: str) -> str:
    """Generate a detailed explanation of slide content with longer output."""
    full_prompt = f"Context:\n\n{context}\n\n{prompt}"
    
    result = qa_model(full_prompt, max_length=512, min_length=100, do_sample=True, temperature=0.7)
    return result[0]['generated_text']