import asyncio
import json
import logging
import os
import re
from typing import Any, Dict, List, Literal, Optional, TypedDict, cast

from langgraph.graph import END, StateGraph

from app.core.config import get_settings
from app.models.interview import CategoryScores, FinalReport, IntegritySummary, QuestionEvaluation

logger = logging.getLogger("uvicorn.error")
settings = get_settings()

DIFFICULTY_TIERS = ["Easy", "Medium", "Hard", "Staff"]


class InterviewState(TypedDict):
    """LangGraph state representing an adaptive technical interview workflow."""
    session_id: str
    user_id: str
    role: str
    seniority: str
    difficulty: str
    resume_summary: Optional[str]
    target_skills: List[str]
    current_question_index: int
    max_questions: int
    current_question: Optional[str]
    candidate_answer: Optional[str]
    evaluation: Optional[Dict[str, Any]]
    evaluations_history: List[Dict[str, Any]]
    difficulty_history: List[str]
    difficulty_change: Optional[str]
    conversation_history: List[Dict[str, str]]
    telemetry_summary: Optional[Dict[str, Any]]
    integrity_summary: Optional[Dict[str, Any]]
    final_report: Optional[Dict[str, Any]]
    is_finished: bool


def _get_llm():
    """Obtain configured LLM instance with safe fallback."""
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return None  # deterministic rapid execution in test suite

    if settings.LLM_PROVIDER == "google" and settings.GOOGLE_API_KEY:
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
            return ChatGoogleGenerativeAI(
                model="gemini-3.8-flash",
                google_api_key=settings.GOOGLE_API_KEY,
                temperature=0.3,
            )
        except Exception as exc:
            logger.warning("Google Gemini initialization failed: %s", exc)

    if settings.OPENAI_API_KEY:
        try:
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(
                model="gpt-4o-mini",
                openai_api_key=settings.OPENAI_API_KEY,
                temperature=0.3,
            )
        except Exception as exc:
            logger.warning("OpenAI initialization failed: %s", exc)

    return None


async def generate_question_node(state: InterviewState) -> Dict[str, Any]:
    """LangGraph node: generate next question tailored to role, skills, evaluation, and telemetry."""
    index = state["current_question_index"]
    role = state["role"]
    seniority = state["seniority"]
    difficulty = state["difficulty"]
    skills = state["target_skills"] or ["Software Engineering", "System Design", "Problem Solving"]
    eval_hist = state["evaluations_history"]
    telemetry = state.get("telemetry_summary") or {}

    # High stress coaching detection
    blink_rate = telemetry.get("blink_rate", 16.0)
    facial_tension = telemetry.get("facial_tension", 0.2)
    is_stressed = blink_rate > 24.0 or facial_tension > 0.65
    supportive_prefix = "Take a breath and feel free to think aloud. " if is_stressed else ""

    target_skill = skills[(index - 1) % len(skills)] if skills else "Architecture"
    llm = _get_llm()

    if llm:
        try:
            prev_context = ""
            if eval_hist:
                last_eval = eval_hist[-1]
                prev_context = f"Previous answer score: {last_eval.get('score')}/10. Weaknesses noted: {last_eval.get('feedback')}."

            prompt = (
                f"You are an expert technical interviewer assessing a {seniority} {role}.\n"
                f"Question #{index} of {state['max_questions']}. Current difficulty tier: {difficulty}.\n"
                f"Focus on skill: {target_skill}.\n"
                f"{prev_context}\n"
                f"Generate a clear, realistic interview question probing practical experience or architectural depth.\n"
                "Return ONLY the question text without introductory pleasantries."
            )
            response = await asyncio.wait_for(llm.ainvoke(prompt), timeout=15.0)
            question_text = supportive_prefix + str(response.content).strip()
        except Exception as exc:
            logger.warning("LLM question generation failed: %s. Using heuristic fallback.", exc)
            question_text = _generate_heuristic_question(index, role, seniority, difficulty, target_skill, supportive_prefix)
    else:
        question_text = _generate_heuristic_question(index, role, seniority, difficulty, target_skill, supportive_prefix)

    conv_hist = list(state["conversation_history"])
    conv_hist.append({"role": "interviewer", "content": question_text})

    diff_hist = list(state["difficulty_history"])
    diff_hist.append(difficulty)

    return {
        "current_question": question_text,
        "conversation_history": conv_hist,
        "difficulty_history": diff_hist,
    }


def _generate_heuristic_question(
    index: int, role: str, seniority: str, difficulty: str, skill: str, prefix: str
) -> str:
    """Fallback question bank covering various roles, seniority levels, and difficulty tiers."""
    questions_pool = {
        1: f"To begin our technical discussion for the {seniority} {role} role, can you walk me through the architecture of a complex {skill} project you recently owned? What were the primary trade-offs?",
        2: f"In {skill}, how do you approach diagnosing performance bottlenecks or memory leaks under high concurrent load? Describe your debugging workflow.",
        3: f"Suppose our distributed system experiences network partitions or eventual consistency lag when reading/writing {skill} state. How would you design fault-tolerant failovers?",
        4: f"When designing APIs and data schemas for {skill}, how do you ensure backwards compatibility, idempotency, and defense against cascading failures?",
        5: f"Reflecting on your engineering experience, describe a critical production incident involving {skill}. What root cause did you uncover and what preventative safeguards did you implement?",
    }

    base = questions_pool.get(
        index,
        f"For question #{index}, how would you architect a scalable, highly available service utilizing {skill} for the {role} role?",
    )

    if difficulty == "Easy":
        base += " (Focus on core fundamentals and typical conventions)."
    elif difficulty in ("Hard", "Staff"):
        base += " (Address distributed consensus, latency tails, and disaster recovery)."

    return prefix + base


async def evaluate_answer_node(state: InterviewState) -> Dict[str, Any]:
    """LangGraph node: score candidate response against question using multi-axis rubric."""
    raw_answer = state.get("candidate_answer") or ""
    answer = raw_answer.strip()
    question = state.get("current_question", "")
    role = state["role"]
    seniority = state["seniority"]
    telemetry = state.get("telemetry_summary") or {}

    # Check if turn was skipped
    if not answer or answer == "SKIPPED":
        eval_data = {
            "score": 0.0,
            "technical_accuracy": 0.0,
            "clarity": 0.0,
            "completeness": 0.0,
            "feedback": "Question was skipped due to response timeout. Moving to next topic.",
            "encouragement": "Take a breath and pace yourself on the next question.",
            "status": "skipped",
        }
        eval_hist = list(state["evaluations_history"])
        eval_hist.append(eval_data)
        conv_hist = list(state["conversation_history"])
        conv_hist.append({"role": "candidate", "content": "[Question Skipped]"})
        return {
            "evaluation": eval_data,
            "evaluations_history": eval_hist,
            "conversation_history": conv_hist,
        }

    llm = _get_llm()
    if llm and len(answer) > 10:
        try:
            prompt = (
                f"You are a principal engineer grading a candidate's technical interview answer.\n"
                f"Target Position: {seniority} {role}\n"
                f"Question Asked: {question}\n"
                f"Candidate Answer: {answer}\n\n"
                "Evaluate the answer strictly in JSON format matching this schema:\n"
                "{\n"
                '  "score": float (0.0 to 10.0),\n'
                '  "technical_accuracy": float (0.0 to 10.0),\n'
                '  "clarity": float (0.0 to 10.0),\n'
                '  "completeness": float (0.0 to 10.0),\n'
                '  "feedback": "1-2 sentences of specific technical critique",\n'
                '  "encouragement": "Optional encouraging remark"\n'
                "}"
            )
            response = await asyncio.wait_for(llm.ainvoke(prompt), timeout=15.0)
            clean_json = re.sub(r"^```(?:json)?\s*|\s*```$", "", str(response.content).strip(), flags=re.MULTILINE)
            eval_data = json.loads(clean_json)
        except Exception as exc:
            logger.warning("LLM evaluation error: %s. Using heuristic rubric.", exc)
            eval_data = _heuristic_evaluate(answer, seniority, telemetry)
    else:
        eval_data = _heuristic_evaluate(answer, seniority, telemetry)

    eval_hist = list(state["evaluations_history"])
    eval_hist.append(eval_data)

    conv_hist = list(state["conversation_history"])
    conv_hist.append({"role": "candidate", "content": answer})

    return {
        "evaluation": eval_data,
        "evaluations_history": eval_hist,
        "conversation_history": conv_hist,
    }


def _heuristic_evaluate(answer: str, seniority: str, telemetry: Dict[str, Any]) -> Dict[str, Any]:
    """Heuristic rubric calculating score based on length, depth, keyword density, and composure."""
    word_count = len(answer.split())
    answer_lower = answer.lower()

    # Detect technical signals
    tech_keywords = [
        "cache", "index", "concurrency", "distributed", "asynchronous", "queue",
        "database", "latency", "throughput", "schema", "resilience", "microservices",
        "trade-off", "tradeoff", "scalability", "metric", "partition", "lock",
        "acid", "api", "rest", "docker", "redis", "postgres", "kafka", "testing",
    ]
    keywords_found = sum(1 for kw in tech_keywords if kw in answer_lower)

    # Base score computation
    if word_count < 10:
        score = 2.5
        tech_acc = 2.0
        clarity = 3.0
        completeness = 2.0
        feedback = "Answer is too brief and lacks technical substance. Please elaborate with architectural specifics."
    elif word_count < 30:
        score = 4.5
        tech_acc = 4.0
        clarity = 5.0
        completeness = 4.0
        feedback = "Good start, but missing discussion of implementation trade-offs and edge cases."
    elif keywords_found >= 4 and word_count >= 50:
        score = 9.0
        tech_acc = 9.2
        clarity = 8.8
        completeness = 9.0
        feedback = "Excellent response demonstrating depth, concrete terminology, and strong architectural reasoning."
    else:
        score = 7.0
        tech_acc = 7.0
        clarity = 7.5
        completeness = 6.8
        feedback = "Solid answer covering the main fundamentals; could go deeper into failure modes."

    # Stress biomarker coaching
    blink_rate = telemetry.get("blink_rate", 16.0)
    encouragement = None
    if blink_rate > 24.0:
        encouragement = "Great composure under pressure! Keep pacing your thoughts steadily."

    return {
        "score": round(score, 1),
        "technical_accuracy": round(tech_acc, 1),
        "clarity": round(clarity, 1),
        "completeness": round(completeness, 1),
        "feedback": feedback,
        "encouragement": encouragement,
    }


def route_next_node(state: InterviewState) -> Literal["generate_question", "end_interview"]:
    """Conditional edge router: handles difficulty progression and termination."""
    if state["current_question_index"] >= state["max_questions"]:
        return "end_interview"
    return "generate_question"


def update_difficulty_state(state: InterviewState) -> Dict[str, Any]:
    """Calculate next difficulty tier and increment question pointer."""
    eval_hist = state.get("evaluations_history", [])
    current_diff = state.get("difficulty", "Medium")
    if current_diff == "Adaptive":
        current_diff = "Medium"

    change = "UNCHANGED"
    next_diff = current_diff

    if eval_hist:
        last_score = eval_hist[-1].get("score", 7.0)

        # Dynamic adaptation rules:
        # Score > 8.0 -> upgrade difficulty tier
        if last_score > 8.0:
            if current_diff == "Easy":
                next_diff = "Medium"
                change = "UPGRADE"
            elif current_diff == "Medium":
                next_diff = "Hard"
                change = "UPGRADE"
            elif current_diff == "Hard":
                next_diff = "Staff"
                change = "UPGRADE"

        # Score < 5.0 -> downgrade difficulty tier
        elif last_score < 5.0:
            if current_diff in ("Staff", "Hard"):
                next_diff = "Medium"
                change = "DOWNGRADE"
            elif current_diff == "Medium":
                next_diff = "Easy"
                change = "DOWNGRADE"

    next_index = state["current_question_index"] + 1

    return {
        "difficulty": next_diff,
        "difficulty_change": change,
        "current_question_index": next_index,
    }


async def end_interview_node(state: InterviewState) -> Dict[str, Any]:
    """LangGraph node: generate comprehensive executive scorecard upon completion."""
    eval_hist = state.get("evaluations_history", [])
    telemetry = state.get("telemetry_summary") or {}
    role = state["role"]
    seniority = state["seniority"]

    if eval_hist:
        avg_tech = sum(e.get("technical_accuracy", 7.0) for e in eval_hist) / len(eval_hist)
        avg_clarity = sum(e.get("clarity", 7.0) for e in eval_hist) / len(eval_hist)
        avg_comp = sum(e.get("completeness", 7.0) for e in eval_hist) / len(eval_hist)
        raw_score = sum(e.get("score", 7.0) for e in eval_hist) / len(eval_hist)
    else:
        avg_tech, avg_clarity, avg_comp, raw_score = 7.0, 7.0, 7.0, 7.0

    # Composure score from biometric telemetry
    eye_contact = telemetry.get("eye_contact_ratio", 0.85)
    composure_score = min(max(eye_contact * 100, 60.0), 98.0)

    # Weighted breakdown (Tech 60%, Comm 25%, Composure 15%)
    tech_percent = round(avg_tech * 10, 1)
    comm_percent = round(avg_clarity * 10, 1)
    overall_score = round((tech_percent * 0.6) + (comm_percent * 0.25) + (composure_score * 0.15), 1)

    # Hiring recommendation decision matrix
    if overall_score >= 85.0:
        hiring_decision = "Strong Hire"
    elif overall_score >= 72.0:
        hiring_decision = "Hire"
    elif overall_score >= 58.0:
        hiring_decision = "Leaning Hire"
    else:
        hiring_decision = "No Hire"

    strengths = [
        f"Demonstrated solid knowledge of {state['role']} conventions.",
        "Articulated system trade-offs with structured communication.",
    ]
    if composure_score >= 80.0:
        strengths.append("Maintained calm, consistent eye contact and professional composure throughout.")

    weaknesses = [
        "Could provide more quantitative performance metrics when proposing architectures.",
        "Consider discussing edge cases and disaster recovery runbooks in greater depth.",
    ]

    integrity_summary_dict = state.get("integrity_summary")
    integrity_summary_obj = (
        IntegritySummary(**integrity_summary_dict) if integrity_summary_dict else None
    )

    report = FinalReport(
        overall_score=overall_score,
        category_scores=CategoryScores(
            technical=tech_percent,
            communication=comm_percent,
            composure=round(composure_score, 1),
        ),
        hiring_recommendation=hiring_decision,
        strengths=strengths,
        weaknesses=weaknesses,
        executive_summary=(
            f"Candidate completed {len(eval_hist)} adaptive interview questions for the {seniority} {role} position. "
            f"Achieved an overall score of {overall_score}/100 with recommendation: {hiring_decision}."
        ),
        integrity_summary=integrity_summary_obj,
    )

    return {
        "final_report": report.model_dump(),
        "is_finished": True,
    }


def build_interview_graph() -> Any:
    """Construct StateGraph workflow with conditional adaptation edges."""
    builder = StateGraph(InterviewState)

    builder.add_node("generate_question", generate_question_node)
    builder.add_node("evaluate_answer", evaluate_answer_node)
    builder.add_node("end_interview", end_interview_node)

    # Workflow structure
    builder.set_entry_point("generate_question")
    builder.add_edge("generate_question", END)  # Pauses for user answer

    builder.add_conditional_edges(
        "evaluate_answer",
        route_next_node,
        {
            "generate_question": "generate_question",
            "end_interview": "end_interview",
        },
    )
    builder.add_edge("end_interview", END)

    return builder.compile()


# Single compiled graph instance
interview_graph = build_interview_graph()


async def start_interview(
    session_id: str,
    user_id: str,
    role: str,
    seniority: str,
    difficulty: str,
    resume_summary: Optional[str] = None,
    target_skills: Optional[List[str]] = None,
    max_questions: int = 5,
) -> InterviewState:
    """Initialize interview state and generate question #1."""
    initial_state: InterviewState = {
        "session_id": session_id,
        "user_id": user_id,
        "role": role,
        "seniority": seniority,
        "difficulty": "Medium" if difficulty == "Adaptive" else difficulty,
        "resume_summary": resume_summary,
        "target_skills": target_skills or [],
        "current_question_index": 1,
        "max_questions": max_questions,
        "current_question": None,
        "candidate_answer": None,
        "evaluation": None,
        "evaluations_history": [],
        "difficulty_history": [],
        "difficulty_change": None,
        "conversation_history": [],
        "telemetry_summary": None,
        "integrity_summary": None,
        "final_report": None,
        "is_finished": False,
    }

    # Run question generator node
    result = await generate_question_node(initial_state)
    initial_state.update(cast(Any, result))
    return initial_state


async def submit_candidate_answer(
    state: InterviewState,
    answer: str,
    telemetry_summary: Optional[Dict[str, Any]] = None,
) -> InterviewState:
    """Process candidate answer: evaluate, update difficulty dynamically, and advance state."""
    state["candidate_answer"] = answer
    if telemetry_summary:
        state["telemetry_summary"] = telemetry_summary

    # 1. Evaluate answer
    eval_updates = await evaluate_answer_node(state)
    state.update(cast(Any, eval_updates))

    # 2. Check conditional routing
    next_step = route_next_node(state)

    if next_step == "end_interview":
        report_updates = await end_interview_node(state)
        state.update(cast(Any, report_updates))
    else:
        # 3. Adapt difficulty and generate question
        diff_updates = update_difficulty_state(state)
        state.update(cast(Any, diff_updates))

        question_updates = await generate_question_node(state)
        state.update(cast(Any, question_updates))

    return state
