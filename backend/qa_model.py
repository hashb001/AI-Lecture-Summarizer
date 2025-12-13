from transformers import pipeline
qa_model = pipeline("text2text-generation", model="google/flan-t5-base")
from openai import OpenAI
import os

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def answer_question(context: str, question: str) -> str:
    
    prompt = (
        "Answer the question using only the information from the lecture below.\n\n"
        "LECTURE:\n"
        f"{context}\n\n"
        "QUESTION:\n"
        f"{question}\n\n"
        "ANSWER:"
    )
    result = qa_model(prompt, max_length=256)
    return result[0]["generated_text"].strip()


def explain_slide(context: str, prompt: str) -> str:
    """Generate a longer, didactic explanation for a single slide."""
    full_prompt = (
        "You are an excellent university tutor. Read the slide context below "
        "and then follow the instruction.\n\n"
        "SLIDE CONTEXT:\n"
        f"{context}\n\n"
        f"{prompt}\n\n"
        "Explanation:"
    )
    result = qa_model(
        full_prompt,
        max_length=512,
        min_length=120,
        do_sample=True,
        temperature=0.7,
    )
    return result[0]["generated_text"].strip()


def generate_assignment_from_lecture(lecture_text: str) -> str:
    prompt = f"""
You are a university instructor. Based ONLY on the lecture content below, write a ready-to-use assignment for university students.

LECTURE CONTENT:
{lecture_text}

Write the FINAL assignment in this structure (but DO NOT repeat this description, just follow it):

Title:
- A short academic-style title for the assignment.

Instructions:
- 2–3 sentences explaining what students must do.

Part A – Short Answer Questions:
- 5 numbered short-answer questions.
- Questions must require understanding of the lecture, not copying.

Part B – Analytical Questions:
- 3 numbered, higher-order questions (explain, compare, evaluate, argue, etc).

Part C – Application Task:
- 1 realistic scenario or problem where students must apply the lecture concepts.

IMPORTANT:
- Output ONLY the finished assignment text.
- Do NOT show any section called “RULES”.
- Do NOT repeat or mention these instructions or the structure description.
- Do NOT include answers.
- Do NOT introduce information that is not in the lecture.
"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are a helpful university instructor."},
            {"role": "user", "content": prompt},
        ],
    )
    return response.choices[0].message.content.strip()



def generate_quiz_from_lecture(lecture_text: str) -> str:
    prompt = f"""
You are a university instructor. Based ONLY on the lecture content below, write a ready-to-use assignment for university students.

LECTURE CONTENT:
{lecture_text}

Write the FINAL assignment in this structure (but DO NOT repeat this description, just follow it):

Title:
- A short academic-style title for the assignment.

Instructions:
- 2–3 sentences explaining what students must do.

Part A – Short Answer Questions:
- 5 numbered short-answer questions.
- Questions must require understanding of the lecture, not copying.

Part B – Analytical Questions:
- 3 numbered, higher-order questions (explain, compare, evaluate, argue, etc).

Part C – Application Task:
- 1 realistic scenario or problem where students must apply the lecture concepts.

IMPORTANT:
- Output ONLY the finished assignment text.
- Do NOT show any section called “RULES”.
- Do NOT repeat or mention these instructions or the structure description.
- Do NOT include answers.
- Do NOT introduce information that is not in the lecture.
"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are a helpful university instructor."},
            {"role": "user", "content": prompt},
        ],
    )
    return response.choices[0].message.content.strip()


