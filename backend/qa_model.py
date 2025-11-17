
from transformers import pipeline

qa_model = pipeline("text2text-generation", model="google/flan-t5-base")

def answer_question(context: str, question: str) -> str:
    prompt = f"Answer based only on the following context:\n\n{context}\n\nQuestion: {question}"
    result = qa_model(prompt, max_length=150)
    return result[0]['generated_text']
