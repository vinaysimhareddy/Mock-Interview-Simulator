import asyncio
import json
import logging
import os
import re
from typing import Any, Dict, List, Literal, Optional, Tuple, TypedDict, cast

from langgraph.graph import END, StateGraph

from app.core.config import get_settings
from app.core.seniority_profiles import (
    SENIORITY_PROFILES,
    calculate_adaptive_step,
    get_difficulty_label,
    get_seniority_profile,
)
from app.models.interview import CategoryScores, FinalReport, IntegritySummary, QuestionEvaluation
from app.repositories.knowledge_base_repo import knowledge_base_repo
from app.repositories.resume_repo import resume_repo
from app.services.difficulty_classifier import classify_difficulty
from app.services.embedding_service import get_embedding_service
from app.services.rag_retrieval_service import RAGRetrievalService
from app.services.resume_chunker import extract_tags_from_text

logger = logging.getLogger("uvicorn.error")
settings = get_settings()

DIFFICULTY_TIERS = ["Easy", "Easy-Medium", "Medium", "Medium-Hard", "Hard/Expert"]

VALID_ACTIONS = [
    "follow_up_probe",
    "follow_up_clarify",
    "deepen",
    "simplify_and_bridge",
    "new_topic_from_resume",
    "new_topic_from_role",
    "behavioral",
    "wrap_up",
]


class InterviewState(TypedDict):
    """LangGraph state representing an adaptive, RAG-grounded technical interview workflow (§Q5)."""
    session_id: str
    user_id: str
    role: str
    seniority: str
    difficulty: str
    numeric_difficulty: float
    resume_summary: Optional[str]
    target_skills: List[str]
    candidate_resume_tags: List[str]
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
    time_left_seconds: Optional[int]
    time_budget_expired: Optional[bool]
    user_ended: Optional[bool]
    is_aborted: Optional[bool]

    # Q5 Dynamic Planning, RAG Context, and Validation fields:
    rag_context: Optional[Dict[str, Any]]
    current_action: str
    current_topic: str
    target_topic: Optional[str]
    action_reason: Optional[str]
    covered_topics: List[str]
    rolling_summary: str
    asked_question_embeddings: List[List[float]]
    consecutive_followups: int
    question_sources: List[Dict[str, Any]]
    validation_feedback: Optional[str]
    generation_attempts: int


def _get_llm():
    """Obtain configured LLM instance with safe fallback."""
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return None  # Deterministic rapid execution in test suite

    if settings.LLM_PROVIDER == "google" and settings.GOOGLE_API_KEY:
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
            return ChatGoogleGenerativeAI(
                model="gemini-2.5-flash",
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


def _cosine_similarity(v1: List[float], v2: List[float]) -> float:
    """Calculate cosine similarity between two float vectors."""
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = sum(a * a for a in v1) ** 0.5
    norm2 = sum(b * b for b in v2) ** 0.5
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)


async def _is_duplicate_question(
    question_text: str,
    asked_embeddings: List[List[float]],
    asked_texts: List[str],
    embedder: Any,
) -> Tuple[bool, float]:
    """Check if question is semantically (>0.82 cosine similarity) or lexically duplicate."""
    q_norm = question_text.strip().lower()

    # 1. Lexical Jaccard token overlap
    q_tokens = set(re.findall(r"\w+", q_norm))
    for past_text in asked_texts:
        past_tokens = set(re.findall(r"\w+", past_text.strip().lower()))
        if not past_tokens:
            continue
        jaccard = len(q_tokens & past_tokens) / len(q_tokens | past_tokens)
        if jaccard >= 0.75:
            return True, jaccard

    # 2. Vector cosine similarity check
    if asked_embeddings:
        try:
            curr_vec = await embedder.embed_query(question_text)
            for past_vec in asked_embeddings:
                sim = _cosine_similarity(curr_vec, past_vec)
                if sim >= 0.82:
                    return True, sim
        except Exception as exc:
            logger.debug("Vector duplicate check fallback: %s", exc)

    return False, 0.0


def _check_grounding(
    question_text: str,
    action: str,
    candidate_resume_tags: List[str],
    retrieved_resume_chunks: List[Dict[str, Any]],
    previous_answer_tags: List[str],
) -> Tuple[bool, Optional[str]]:
    """Verify that any referenced technologies or projects exist in candidate context."""
    if action not in ("new_topic_from_resume", "follow_up_probe"):
        return True, None

    evidence: set = {t.lower() for t in candidate_resume_tags}
    for t in previous_answer_tags:
        evidence.add(t.lower())
    for chunk in retrieved_resume_chunks:
        for t in chunk.get("tech_tags", []):
            evidence.add(t.lower())
        chunk_text = chunk.get("chunk_text", "").lower()
        for w in re.findall(r"\b[a-zA-Z0-9_\-\.]{3,}\b", chunk_text):
            evidence.add(w)

    q_tags = extract_tags_from_text(question_text)

    # Universal terms allowed across any software role without explicit resume mention
    universal_terms = {
        "api", "database", "testing", "unit test", "integration test", "http", "rest",
        "crud", "git", "sql", "code", "architecture", "debugging", "cache", "caching",
        "performance", "scalability", "concurrency", "security", "logging", "monitoring",
    }

    ungrounded_techs = []
    for tag in q_tags:
        t_low = tag.lower()
        if t_low in universal_terms:
            continue
        if not any(t_low == ev or t_low in ev or ev in t_low for ev in evidence):
            ungrounded_techs.append(tag)

    if ungrounded_techs and action == "new_topic_from_resume":
        return False, (
            f"Question references technologies {ungrounded_techs} not found in candidate resume or background. "
            f"Candidate evidence: {list(evidence)[:8]}"
        )

    return True, None


def _get_fallback_kb_question(
    role: str,
    seniority: str,
    target_topic: Optional[str],
    asked_texts: List[str],
    rag_context: Optional[Dict[str, Any]],
) -> str:
    """Retrieve an authored, vetted question from Knowledge Base as safe fallback (§Q5)."""
    asked_set = {t.strip().lower() for t in asked_texts}

    # 1. Try questions from retrieved KB topics in rag_context
    if rag_context:
        for kb_item in rag_context.get("kb_topics", []):
            samples = kb_item.get("sample_questions", [])
            for q in samples:
                if q.strip().lower() not in asked_set:
                    logger.warning(
                        "Question generation fallback: Using retrieved KB sample question for %s %s [%s]: %s",
                        seniority, role, kb_item.get("topic"), q
                    )
                    return q

    # 2. Try looking up in role/seniority profile question banks
    profile = get_seniority_profile(seniority)
    pool = {
        "Junior": [
            f"In {role} development, what is the difference between synchronous and asynchronous request processing?",
            f"How do you approach writing unit tests and validating edge cases for a {role} feature?",
            f"Can you explain the standard HTTP status codes you return when building a REST API?",
        ],
        "Mid": [
            f"How would you structure a REST API for order management in a {role} system, including error handling and data validation?",
            f"When implementing caching for a high-read service, what eviction strategy and TTL would you choose, and why?",
            f"Describe how you design database indexes for a query experiencing slow response times under load.",
        ],
        "Senior": [
            f"How would you design a distributed caching strategy to handle high-read traffic while preventing cache stampedes and thundering herds?",
            f"Describe how you implement the transactional outbox pattern or saga pattern to maintain eventual consistency across microservices.",
            f"Walk me through your methodology for analyzing a CPU or memory bottleneck using flamegraphs or heap dumps.",
        ],
        "Staff": [
            f"How would you architect a multi-region active-active deployment considering data consistency, latency SLAs, and disaster recovery?",
            f"What organizational and architectural strategies would you put in place to establish zero-trust security and blast-radius containment across all services?",
            f"How do you design a unified platform engineering standard across disparate engineering teams without slowing down delivery velocity?",
        ],
    }

    tier_pool = pool.get(profile.name, pool["Mid"])
    for q in tier_pool:
        if q.strip().lower() not in asked_set:
            logger.warning(
                "Question generation fallback: Using vetted %s pool question: %s",
                profile.name, q
            )
            return q

    # Final guaranteed fallback
    return f"Can you describe an architectural challenge you recently solved in your {role} work, focusing on the trade-offs involved?"


async def plan_turn_node(state: InterviewState) -> Dict[str, Any]:
    """
    LangGraph node: structured action selection choosing from the 8-action matrix (§2.1).
    Enforces:
    - <= 2 consecutive follow-ups on the same topic before forcing a new topic.
    - At least one behavioral/STAR question per ~5 questions.
    - wrap_up when time budget is expiring (<180s) or max questions reached.
    """
    index = state.get("current_question_index", 1)
    max_q = state.get("max_questions", 9999)
    time_left = state.get("time_left_seconds")
    eval_hist = state.get("evaluations_history", [])
    consecutive = state.get("consecutive_followups", 0)
    current_topic = state.get("current_topic", "")
    covered_topics = state.get("covered_topics", [])
    resume_tags = state.get("candidate_resume_tags", [])
    role = state.get("role", "Software Engineer")

    # Rule 1: Time budget expiration or final question cap -> wrap_up
    if (time_left is not None and time_left < 180) or index > max_q:
        return {
            "current_action": "wrap_up",
            "target_topic": "Wrap-up & Candidate Questions",
            "action_reason": "Time budget remaining is low (<180s) or target question count reached.",
            "consecutive_followups": 0,
        }

    # Rule 2: Behavioral STAR question cadence (every 5th question: 5, 10, etc.)
    if index % 5 == 0 and index > 1:
        return {
            "current_action": "behavioral",
            "target_topic": "Engineering Collaboration & Production Incident Management",
            "action_reason": "Mandatory STAR behavioral assessment scheduled every 5 questions.",
            "consecutive_followups": 0,
        }

    # Rule 3: Start of interview (Question 1)
    if index == 1 and not eval_hist:
        if resume_tags:
            target = resume_tags[0]
            action = "new_topic_from_resume"
            reason = f"Grounding initial interview discussion in candidate's primary resume skill: {target}."
        else:
            target = "Core Architecture & Fundamentals"
            action = "new_topic_from_role"
            reason = "Starting interview with foundational role architecture domain."
        return {
            "current_action": action,
            "target_topic": target,
            "action_reason": reason,
            "consecutive_followups": 0,
        }

    # Rule 4: Consecutive follow-ups exhausted (cap of 2) -> force transition to new topic
    if consecutive >= 2:
        unexplored_resume = [
            t for t in resume_tags
            if not any(t.lower() == c.lower() for c in covered_topics)
        ]
        if unexplored_resume:
            return {
                "current_action": "new_topic_from_resume",
                "target_topic": unexplored_resume[0],
                "action_reason": f"Topic '{current_topic}' exhausted after 2 follow-ups. Moving to unexplored resume skill: {unexplored_resume[0]}.",
                "consecutive_followups": 0,
            }
        else:
            role_topics = ["API Design & REST", "Database & Indexing", "Caching & Concurrency", "System Reliability & Testing"]
            unexplored_role = [t for t in role_topics if not any(t.lower() in c.lower() for c in covered_topics)]
            target = unexplored_role[0] if unexplored_role else "Production Troubleshooting & Metrics"
            return {
                "current_action": "new_topic_from_role",
                "target_topic": target,
                "action_reason": f"Topic '{current_topic}' exhausted after 2 follow-ups. Moving to core role competency: {target}.",
                "consecutive_followups": 0,
            }

    # Rule 5: Candidate answer analysis for adaptive routing
    last_eval = eval_hist[-1] if eval_hist else {}
    last_score = last_eval.get("score", 7.0)
    last_answer = (state.get("candidate_answer") or "").strip().lower()
    answer_words = last_answer.split()

    uncertainty_signals = ["i don't know", "i do not know", "not sure", "no idea", "pass", "skip", "haven't used"]
    is_uncertain = any(sig in last_answer for sig in uncertainty_signals)

    if is_uncertain or last_score <= 4.0:
        # Weak or uncertain response
        return {
            "current_action": "simplify_and_bridge",
            "target_topic": current_topic or "Core Fundamentals",
            "action_reason": f"Candidate struggled (score {last_score}/10 or uncertainty). Simplifying concept and bridging kindly.",
            "consecutive_followups": consecutive + 1,
        }

    if last_score >= 8.0:
        # Strong answer -> go one level deeper
        return {
            "current_action": "deepen",
            "target_topic": current_topic or "Architecture",
            "action_reason": f"Candidate scored strongly ({last_score}/10). Deepening architectural inquiry within seniority cap.",
            "consecutive_followups": consecutive + 1,
        }

    # Check for specific technology claims in answer
    extracted = extract_tags_from_text(last_answer)
    if extracted and last_score >= 5.0:
        probe_target = extracted[0]
        return {
            "current_action": "follow_up_probe",
            "target_topic": probe_target,
            "action_reason": f"Candidate explicitly highlighted '{probe_target}'. Probing implementation rationale and edge cases.",
            "consecutive_followups": consecutive + 1,
        }

    if len(answer_words) < 15 and not is_uncertain:
        # Vague or brief response
        return {
            "current_action": "follow_up_clarify",
            "target_topic": current_topic or "Implementation Details",
            "action_reason": "Candidate answer was brief or vague. Probing for specific clarification.",
            "consecutive_followups": consecutive + 1,
        }

    # Default transition
    unexplored_resume = [t for t in resume_tags if not any(t.lower() == c.lower() for c in covered_topics)]
    if unexplored_resume:
        return {
            "current_action": "new_topic_from_resume",
            "target_topic": unexplored_resume[0],
            "action_reason": f"Progressing to unexplored candidate resume capability: {unexplored_resume[0]}.",
            "consecutive_followups": 0,
        }

    return {
        "current_action": "new_topic_from_role",
        "target_topic": "Data Modeling & Storage",
        "action_reason": "Progressing to core role competency.",
        "consecutive_followups": 0,
    }


async def retrieve_context_node(state: InterviewState) -> Dict[str, Any]:
    """LangGraph node: multi-source retrieval (resume chunks + knowledge base) with token budgeting."""
    retrieval_service = RAGRetrievalService()
    rag_result = await retrieval_service.retrieve_context(
        role=state["role"],
        seniority=state["seniority"],
        previous_question=state.get("current_question"),
        previous_answer=state.get("candidate_answer"),
        user_id=state.get("user_id"),
        target_topic=state.get("target_topic"),
        covered_topics=state.get("covered_topics"),
        top_k_resume=3,
        top_k_kb=4,
    )

    rag_dict = rag_result.model_dump()
    sources: List[Dict[str, Any]] = []

    for chunk in rag_dict.get("resume_chunks", []):
        sources.append({
            "source": "resume",
            "title": chunk.get("section_title", "Candidate Resume"),
            "snippet": chunk.get("chunk_text", "")[:120],
        })

    for kb in rag_dict.get("kb_topics", []):
        sources.append({
            "source": "knowledge_base",
            "title": f"{kb.get('topic')} - {kb.get('subtopic')}",
            "snippet": kb.get("expected_depth", "")[:120],
        })

    return {
        "rag_context": rag_dict,
        "question_sources": sources,
    }


async def generate_question_node(state: InterviewState) -> Dict[str, Any]:
    """
    LangGraph node: generate next question grounded in RAG context, candidate words,
    selected action, and strict seniority profiles (§Q5).
    """
    index = state["current_question_index"]
    role = state["role"]
    seniority = state["seniority"]
    profile = get_seniority_profile(seniority)
    numeric_diff = state.get("numeric_difficulty", profile.start_difficulty)
    difficulty_label = get_difficulty_label(numeric_diff)
    action = state.get("current_action", "new_topic_from_role")
    target_topic = state.get("target_topic") or "General"
    rag_context = state.get("rag_context") or {}
    prev_answer = state.get("candidate_answer")
    prev_question = state.get("current_question")
    validation_feedback = state.get("validation_feedback")
    rolling_summary = state.get("rolling_summary", "")

    # Telemetry support prefix
    telemetry = state.get("telemetry_summary") or {}
    blink_rate = telemetry.get("blink_rate", 16.0)
    facial_tension = telemetry.get("facial_tension", 0.2)
    is_stressed = blink_rate > 24.0 or facial_tension > 0.65
    supportive_prefix = "Take a breath and feel free to think aloud. " if is_stressed else ""

    llm = _get_llm()

    if llm:
        try:
            feedback_prompt = ""
            if validation_feedback:
                feedback_prompt = (
                    f"\nCRITICAL INSTRUCTION - PREVIOUS DRAFT REJECTED: {validation_feedback}\n"
                    f"You must fix this violation in your new question.\n"
                )

            follow_up_guidance = ""
            if action in ("follow_up_probe", "follow_up_clarify", "deepen"):
                follow_up_guidance = (
                    f"Candidate's previous response: \"{prev_answer}\"\n"
                    f"Explicitly weave in the candidate's words or technology choice naturally in the opening."
                )

            prompt = (
                f"You are an expert technical interviewer conducting an interview for a {seniority} {role}.\n"
                f"Question #{index} of {state['max_questions']}. Current difficulty tier: {numeric_diff:.1f} ({difficulty_label}).\n"
                f"Planned Action: {action.upper()}\n"
                f"Target Topic: {target_topic}\n"
                f"{feedback_prompt}\n"
                f"--- SENIORITY PROFILE ---\n"
                f"{profile.style_prompt}\n"
                f"Allowed difficulty range: [{profile.min_difficulty}, {profile.max_difficulty}].\n"
                f"FORBIDDEN TOPICS (DO NOT ASK): {profile.forbidden_topics}\n\n"
                f"--- RAG CONTEXT ---\n"
                f"{rag_context.get('formatted_prompt_context', 'No additional context')}\n\n"
                f"--- INTERVIEW SUMMARY SO FAR ---\n"
                f"{rolling_summary if rolling_summary else 'Interview has just started.'}\n\n"
                f"{follow_up_guidance}\n\n"
                f"Generate ONE clear, realistic interview question.\n"
                f"Return ONLY the question text without conversational fluff or introductory pleasantries."
            )
            response = await asyncio.wait_for(llm.ainvoke(prompt), timeout=15.0)
            question_text = supportive_prefix + str(response.content).strip()
        except Exception as exc:
            logger.warning("LLM question generation failed: %s. Using heuristic RAG generator.", exc)
            question_text = _generate_grounded_heuristic_question(
                action=action,
                target_topic=target_topic,
                role=role,
                seniority=seniority,
                profile=profile,
                rag_context=rag_context,
                prefix=supportive_prefix,
            )
    else:
        question_text = _generate_grounded_heuristic_question(
            action=action,
            target_topic=target_topic,
            role=role,
            seniority=seniority,
            profile=profile,
            rag_context=rag_context,
            prefix=supportive_prefix,
        )

    return {
        "current_question": question_text,
        "current_topic": target_topic,
    }


def _generate_grounded_heuristic_question(
    action: str,
    target_topic: str,
    role: str,
    seniority: str,
    profile: Any,
    rag_context: Dict[str, Any],
    prefix: str,
) -> str:
    """Generate adaptive, role-grounded questions deterministically without hardcoded static pools."""
    kb_topics = rag_context.get("kb_topics", [])

    # Check if a matching KB topic provides an authored sample question within bounds
    for kb in kb_topics:
        if target_topic.lower() in kb.get("topic", "").lower() or target_topic.lower() in kb.get("subtopic", "").lower():
            samples = kb.get("sample_questions", [])
            if samples:
                return prefix + samples[0]

    # Action-specific adaptive phrasing grounded in target topic and seniority style
    if action == "behavioral":
        q = f"Reflecting on your experience as a {seniority} {role}, describe a critical production incident or technical disagreement regarding {target_topic}. How did you resolve it and what safeguards did you put in place?"
    elif action == "simplify_and_bridge":
        q = f"Let's step back and look at {target_topic} from a foundational perspective. In {role} development, how do you typically approach the basics of {target_topic}?"
    elif action == "follow_up_probe":
        q = f"Earlier you mentioned working with {target_topic}. What key trade-offs did you evaluate, and how did you handle potential edge cases or failure modes?"
    elif action == "follow_up_clarify":
        q = f"Could you walk me through a specific implementation example of {target_topic}? What were the key architectural steps?"
    elif action == "deepen":
        q = f"Building on your solid explanation of {target_topic}, how would you optimize this setup when handling high concurrent traffic or strict latency constraints?"
    elif action == "new_topic_from_resume":
        q = f"Looking at your background in {target_topic}, could you explain your architectural approach and the key decisions you made when implementing it?"
    elif action == "wrap_up":
        q = "We're nearing the conclusion of our technical interview. Do you have any questions for me regarding our engineering architecture or team technical challenges?"
    else:  # new_topic_from_role
        if kb_topics and kb_topics[0].get("sample_questions"):
            q = kb_topics[0]["sample_questions"][0]
        else:
            q = f"For a {seniority} {role}, how do you approach {target_topic} when designing reliable, maintainable services?"

    return prefix + q


async def validate_question_node(state: InterviewState) -> Dict[str, Any]:
    """
    LangGraph node: validate generated question against:
    1. Duplicate check (vector similarity < 0.82 and lexical Jaccard)
    2. Grounding check (technologies must exist in candidate context)
    3. Seniority check (classify_difficulty within allowed range, no forbidden topics)
    Fallback ladder:
    LLM generation -> retry with feedback (up to 2) -> authored KB question -> vetted profile question.
    """
    question_text = state.get("current_question", "")
    role = state["role"]
    seniority = state["seniority"]
    action = state.get("current_action", "")
    target_topic = state.get("target_topic")
    attempts = state.get("generation_attempts", 0) + 1
    embedder = get_embedding_service()

    asked_embeddings = state.get("asked_question_embeddings", [])
    conv_hist = state.get("conversation_history", [])
    asked_texts = [item["content"] for item in conv_hist if item.get("role") == "interviewer"]

    rag_ctx = state.get("rag_context") or {}
    resume_chunks = rag_ctx.get("resume_chunks", [])
    answer_tags = rag_ctx.get("extracted_answer_tags", [])
    resume_tags = state.get("candidate_resume_tags", [])

    violation_reason: Optional[str] = None

    # 1. Duplicate check
    is_dup, sim_score = await _is_duplicate_question(question_text, asked_embeddings, asked_texts, embedder)
    if is_dup:
        violation_reason = f"Duplicate question detected (similarity {sim_score:.2f} >= 0.82 to previous question)."

    # 2. Grounding check
    if not violation_reason:
        is_grounded, ground_err = _check_grounding(
            question_text=question_text,
            action=action,
            candidate_resume_tags=resume_tags,
            retrieved_resume_chunks=resume_chunks,
            previous_answer_tags=answer_tags,
        )
        if not is_grounded:
            violation_reason = ground_err

    # 3. Seniority and forbidden topics check
    if not violation_reason:
        classification = await classify_difficulty(
            question_text=question_text,
            target_seniority=seniority,
            role=role,
            candidate_resume_tags=resume_tags,
            use_llm=False,
        )
        if classification.is_too_hard_for_level:
            violation_reason = (
                f"Question exceeds {seniority} seniority ceiling: {classification.reason}. "
                f"Estimated tier {classification.estimated_tier:.1f} exceeds allowed profile range."
            )

    # Fallback ladder enforcement
    if violation_reason:
        if attempts < 2:
            logger.info("Question validation rejected (attempt %d/2): %s", attempts, violation_reason)
            return {
                "validation_feedback": violation_reason,
                "generation_attempts": attempts,
            }
        else:
            # Fallback ladder Step 3: Authored KB question
            logger.warning(
                "Question validation failed after %d attempts: %s. Falling back to authored KB question.",
                attempts, violation_reason
            )
            fallback_q = _get_fallback_kb_question(
                role=role,
                seniority=seniority,
                target_topic=target_topic,
                asked_texts=asked_texts,
                rag_context=rag_ctx,
            )
            question_text = fallback_q
            violation_reason = None

    # Passed validation (or fallback selected)
    try:
        q_vec = await embedder.embed_query(question_text)
        new_embeddings = list(asked_embeddings) + [q_vec]
    except Exception as exc:
        logger.debug("Failed to embed question: %s", exc)
        new_embeddings = list(asked_embeddings)

    new_conv = list(conv_hist)
    new_conv.append({"role": "interviewer", "content": question_text})

    diff_hist = list(state.get("difficulty_history", []))
    diff_hist.append(state.get("difficulty", "Medium"))

    return {
        "current_question": question_text,
        "conversation_history": new_conv,
        "difficulty_history": diff_hist,
        "asked_question_embeddings": new_embeddings,
        "validation_feedback": None,
        "generation_attempts": 0,
    }


def route_after_validation(state: InterviewState) -> Literal["retry_generate", "ready"]:
    """Conditional edge router: retry generation if validation feedback is present and attempts < 2."""
    if state.get("validation_feedback") and state.get("generation_attempts", 0) < 2:
        return "retry_generate"
    return "ready"


async def evaluate_answer_node(state: InterviewState) -> Dict[str, Any]:
    """LangGraph node: score candidate response against question using multi-axis rubric."""
    raw_answer = state.get("candidate_answer") or ""
    answer = raw_answer.strip()
    question = state.get("current_question", "")
    role = state["role"]
    seniority = state["seniority"]
    telemetry = state.get("telemetry_summary") or {}

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
        eval_hist = list(state.get("evaluations_history", []))
        eval_hist.append(eval_data)
        conv_hist = list(state.get("conversation_history", []))
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

    eval_hist = list(state.get("evaluations_history", []))
    eval_hist.append(eval_data)

    conv_hist = list(state.get("conversation_history", []))
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

    tech_keywords = [
        "cache", "index", "concurrency", "distributed", "asynchronous", "queue",
        "database", "latency", "throughput", "schema", "resilience", "microservices",
        "trade-off", "tradeoff", "scalability", "metric", "partition", "lock",
        "acid", "api", "rest", "docker", "redis", "postgres", "kafka", "testing",
        "fastapi", "sqlalchemy", "pool", "async", "engine", "replica", "replication",
        "sql", "nosql", "orm", "routing", "pipeline", "alembic", "monitoring",
    ]
    keywords_found = sum(1 for kw in tech_keywords if kw in answer_lower)

    if word_count < 8:
        score = 2.5
        tech_acc = 2.0
        clarity = 3.0
        completeness = 2.0
        feedback = "Answer is too brief and lacks technical substance. Please elaborate with architectural specifics."
    elif keywords_found >= 3 and word_count >= 30:
        score = 9.0
        tech_acc = 9.2
        clarity = 8.8
        completeness = 9.0
        feedback = "Excellent response demonstrating depth, concrete terminology, and strong architectural reasoning."
    elif keywords_found >= 1 and word_count >= 15:
        score = 7.5
        tech_acc = 7.5
        clarity = 7.8
        completeness = 7.2
        feedback = "Solid answer covering practical implementation details; could go deeper into failure modes."
    elif word_count < 25:
        score = 4.5
        tech_acc = 4.0
        clarity = 5.0
        completeness = 4.0
        feedback = "Good start, but missing discussion of implementation trade-offs and edge cases."
    else:
        score = 7.0
        tech_acc = 7.0
        clarity = 7.5
        completeness = 6.8
        feedback = "Solid answer covering the main fundamentals; could go deeper into failure modes."

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


async def update_summary_node(state: InterviewState) -> Dict[str, Any]:
    """LangGraph node: append the turn's Q&A and evaluation to rolling summary (§Q5)."""
    index = state.get("current_question_index", 1)
    action = state.get("current_action", "unknown")
    topic = state.get("current_topic", "General")
    question = state.get("current_question", "")
    answer = state.get("candidate_answer", "")
    eval_data = state.get("evaluation") or {}

    score = eval_data.get("score", 0.0)
    feedback = eval_data.get("feedback", "")

    answer_words = answer.split()
    answer_summary = " ".join(answer_words[:30]) + ("..." if len(answer_words) > 30 else "")

    turn_entry = (
        f"Turn {index} [{action} | {topic}]:\n"
        f"- Q: {question}\n"
        f"- A: {answer_summary}\n"
        f"- Score: {score}/10 | Feedback: {feedback}\n"
    )

    rolling = state.get("rolling_summary", "")
    new_rolling = (rolling + "\n" + turn_entry).strip()

    covered = list(state.get("covered_topics", []))
    if topic and topic not in covered:
        covered.append(topic)

    return {
        "rolling_summary": new_rolling,
        "covered_topics": covered,
    }


def update_difficulty_node(state: InterviewState) -> Dict[str, Any]:
    """Calculate next difficulty tier using calculate_adaptive_step clamped to seniority profile (§Q4, §Q5)."""
    eval_hist = state.get("evaluations_history", [])
    seniority = state.get("seniority", "Mid")
    profile = get_seniority_profile(seniority)

    current_numeric = state.get("numeric_difficulty", profile.start_difficulty)
    last_eval = eval_hist[-1] if eval_hist else {}
    raw_score = last_eval.get("score", 7.0)
    score_5 = raw_score / 2.0  # Normalize 0..10 to 0..5 scale

    action = state.get("current_action", "")
    requested_simplify = (action == "simplify_and_bridge") or ("don't know" in (state.get("candidate_answer") or "").lower())

    new_numeric, new_label = calculate_adaptive_step(
        current_difficulty=current_numeric,
        answer_score=score_5,
        seniority=seniority,
        candidate_requested_simplify=requested_simplify,
    )

    if new_numeric > current_numeric:
        change = "UPGRADE"
    elif new_numeric < current_numeric:
        change = "DOWNGRADE"
    else:
        change = "UNCHANGED"

    next_index = state.get("current_question_index", 1) + 1

    return {
        "numeric_difficulty": new_numeric,
        "difficulty": new_label,
        "difficulty_change": change,
        "current_question_index": next_index,
    }


def route_next_node(state: InterviewState) -> Literal["plan_turn", "end_interview"]:
    """Conditional edge router: handles interview termination."""
    if (
        state.get("time_budget_expired")
        or state.get("user_ended")
        or state.get("is_aborted")
        or state.get("is_finished")
        or state.get("current_action") == "wrap_up"
    ):
        return "end_interview"

    max_q = state.get("max_questions", 9999)
    if max_q is not None and max_q < 9999 and state.get("current_question_index", 1) > max_q:
        return "end_interview"

    return "plan_turn"


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

    tech_percent = round(avg_tech * 10, 1)
    comm_percent = round(avg_clarity * 10, 1)

    eye_contact = telemetry.get("eye_contact_ratio")
    posture = telemetry.get("posture_score")

    if eye_contact is not None and posture is not None:
        composure_score = round(((float(eye_contact) * 0.6) + (float(posture) * 0.4)) * 100.0, 1)
        overall_score = round((tech_percent * 0.6) + (comm_percent * 0.25) + (composure_score * 0.15), 1)
    elif eye_contact is not None:
        composure_score = round(float(eye_contact) * 100.0, 1)
        overall_score = round((tech_percent * 0.6) + (comm_percent * 0.25) + (composure_score * 0.15), 1)
    elif posture is not None:
        composure_score = round(float(posture) * 100.0, 1)
        overall_score = round((tech_percent * 0.6) + (comm_percent * 0.25) + (composure_score * 0.15), 1)
    else:
        composure_score = comm_percent
        overall_score = round((tech_percent * 0.70) + (comm_percent * 0.30), 1)

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
    """Construct StateGraph workflow with RAG retrieval, validators, and adaptive transitions."""
    builder = StateGraph(InterviewState)

    builder.add_node("plan_turn", plan_turn_node)
    builder.add_node("retrieve_context", retrieve_context_node)
    builder.add_node("generate_question", generate_question_node)
    builder.add_node("validate_question", validate_question_node)
    builder.add_node("evaluate_answer", evaluate_answer_node)
    builder.add_node("update_summary", update_summary_node)
    builder.add_node("update_difficulty", update_difficulty_node)
    builder.add_node("end_interview", end_interview_node)

    # Question generation flow
    builder.set_entry_point("plan_turn")
    builder.add_edge("plan_turn", "retrieve_context")
    builder.add_edge("retrieve_context", "generate_question")
    builder.add_edge("generate_question", "validate_question")

    builder.add_conditional_edges(
        "validate_question",
        route_after_validation,
        {
            "retry_generate": "generate_question",
            "ready": END,
        },
    )

    # Answer evaluation and turn progression flow
    builder.add_edge("evaluate_answer", "update_summary")
    builder.add_edge("update_summary", "update_difficulty")
    builder.add_conditional_edges(
        "update_difficulty",
        route_next_node,
        {
            "plan_turn": "plan_turn",
            "end_interview": "end_interview",
        },
    )
    builder.add_edge("end_interview", END)

    return builder.compile()


interview_graph = build_interview_graph()


async def start_interview(
    session_id: str,
    user_id: str,
    role: str,
    seniority: str,
    difficulty: str,
    resume_summary: Optional[str] = None,
    target_skills: Optional[List[str]] = None,
    max_questions: int = 9999,
) -> InterviewState:
    """Initialize interview state and generate question #1 grounded in resume and RAG."""
    profile = get_seniority_profile(seniority)
    start_numeric = profile.start_difficulty
    start_label = get_difficulty_label(start_numeric)

    # Retrieve candidate resume tags
    candidate_resume_tags: List[str] = list(target_skills) if target_skills else []
    if user_id:
        try:
            user_resumes = await resume_repo.list_by_user(user_id, limit=1)
            if user_resumes:
                parsed = user_resumes[0].get("parsed_profile") or {}
                skills = parsed.get("skills") or []
                for s in skills:
                    if s not in candidate_resume_tags:
                        candidate_resume_tags.append(s)
        except Exception as exc:
            logger.debug("Could not fetch user resume tags: %s", exc)

    if resume_summary:
        for t in extract_tags_from_text(resume_summary):
            if t not in candidate_resume_tags:
                candidate_resume_tags.append(t)

    initial_state: InterviewState = {
        "session_id": session_id,
        "user_id": user_id,
        "role": role,
        "seniority": seniority,
        "difficulty": start_label,
        "numeric_difficulty": start_numeric,
        "resume_summary": resume_summary,
        "target_skills": target_skills or [],
        "candidate_resume_tags": candidate_resume_tags,
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
        "time_left_seconds": None,
        "time_budget_expired": False,
        "user_ended": False,
        "is_aborted": False,
        "rag_context": None,
        "current_action": "new_topic_from_resume" if candidate_resume_tags else "new_topic_from_role",
        "current_topic": "",
        "target_topic": candidate_resume_tags[0] if candidate_resume_tags else None,
        "action_reason": "Interview inception",
        "covered_topics": [],
        "rolling_summary": "",
        "asked_question_embeddings": [],
        "consecutive_followups": 0,
        "question_sources": [],
        "validation_feedback": None,
        "generation_attempts": 0,
    }

    # Execute generation pipeline: plan -> retrieve -> generate -> validate
    plan_res = await plan_turn_node(initial_state)
    initial_state.update(cast(Any, plan_res))

    rag_res = await retrieve_context_node(initial_state)
    initial_state.update(cast(Any, rag_res))

    attempts = 0
    while attempts < 3:
        gen_res = await generate_question_node(initial_state)
        initial_state.update(cast(Any, gen_res))

        val_res = await validate_question_node(initial_state)
        initial_state.update(cast(Any, val_res))

        if not initial_state.get("validation_feedback"):
            break
        attempts += 1

    return initial_state


async def submit_candidate_answer(
    state: InterviewState,
    answer: str,
    telemetry_summary: Optional[Dict[str, Any]] = None,
) -> InterviewState:
    """Process candidate answer: evaluate, update rolling summary, adapt difficulty, and generate next question."""
    state["candidate_answer"] = answer
    if telemetry_summary:
        state["telemetry_summary"] = telemetry_summary

    # 1. Evaluate answer
    eval_updates = await evaluate_answer_node(state)
    state.update(cast(Any, eval_updates))

    # 2. Update rolling summary
    summary_updates = await update_summary_node(state)
    state.update(cast(Any, summary_updates))

    # 3. Check routing to see if interview ended
    next_step = route_next_node(state)
    if next_step == "end_interview":
        report_updates = await end_interview_node(state)
        state.update(cast(Any, report_updates))
        return state

    # 4. Adapt difficulty
    diff_updates = update_difficulty_node(state)
    state.update(cast(Any, diff_updates))

    # 5. Plan turn and execute question pipeline
    plan_res = await plan_turn_node(state)
    state.update(cast(Any, plan_res))

    if state.get("current_action") == "wrap_up":
        # Conclude if planner signaled wrap_up
        report_updates = await end_interview_node(state)
        state.update(cast(Any, report_updates))
        return state

    rag_res = await retrieve_context_node(state)
    state.update(cast(Any, rag_res))

    attempts = 0
    while attempts < 3:
        gen_res = await generate_question_node(state)
        state.update(cast(Any, gen_res))

        val_res = await validate_question_node(state)
        state.update(cast(Any, val_res))

        if not state.get("validation_feedback"):
            break
        attempts += 1

    return state
