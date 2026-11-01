import re
from typing import Any, Dict, List, Set
from app.models.resume_chunk import ChunkSection, ResumeChunkCreate

# Comprehensive list of standard software engineering tools, languages, and frameworks for tag extraction
COMMON_TECH_KEYWORDS: Set[str] = {
    "java", "python", "javascript", "typescript", "c++", "c#", "go", "golang", "rust", "php", "ruby", "kotlin", "swift",
    "spring", "spring boot", "django", "fastapi", "flask", "express", "nestjs", "nodejs", "react", "nextjs", "angular", "vue",
    "postgresql", "postgres", "mysql", "mongodb", "redis", "elasticsearch", "cassandra", "dynamodb", "sqlite", "oracle",
    "kafka", "rabbitmq", "sqs", "sns", "celery", "grpc", "graphql", "rest", "restful", "rest api", "websocket", "docker", "kubernetes",
    "k8s", "aws", "gcp", "azure", "terraform", "ansible", "ci/cd", "github actions", "gitlab", "jenkins",
    "git", "linux", "microservices", "system design", "distributed systems", "concurrency", "multithreading", "asynchronous",
    "pytest", "junit", "mockito", "jest", "cypress", "playwright", "selenium", "hibernate", "jpa", "prisma", "caching",
}


def estimate_token_count(text: str) -> int:
    """Approximate token count (standard ~4 characters per token)."""
    return max(1, len(text) // 4)


_estimate_tokens = estimate_token_count


def extract_tags_from_text(text: str, known_skills: List[str] = None) -> List[str]:
    """
    Extract technology tags from text by matching against known skills and standard tech keywords.
    Deduplicates and preserves canonical casing.
    """
    found_tags: Set[str] = set()
    text_lower = text.lower()

    if known_skills:
        for skill in known_skills:
            if not skill:
                continue
            skill_clean = skill.strip()
            # Boundary-safe search
            pattern = r"(?<!\w)" + re.escape(skill_clean.lower()) + r"(?!\w)"
            if re.search(pattern, text_lower):
                found_tags.add(skill_clean)

    for kw in COMMON_TECH_KEYWORDS:
        pattern = r"(?<!\w)" + re.escape(kw) + r"(?!\w)"
        if re.search(pattern, text_lower):
            # Format canonical tag name
            found_tags.add(kw.title() if len(kw) > 3 else kw.upper())

    return sorted(list(found_tags))


def _split_long_text(text: str, max_tokens: int = 350, overlap_pct: float = 0.15) -> List[str]:
    """
    Split text into chunks of target token size with overlap based on sentences.
    Target: 200 to 400 tokens with 15% overlap (§2.3).
    """
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: List[str] = []
    current_sentences: List[str] = []
    current_tokens = 0

    for sent in sentences:
        sent_tokens = _estimate_tokens(sent)
        if current_tokens + sent_tokens > max_tokens and current_sentences:
            chunk_str = " ".join(current_sentences).strip()
            if chunk_str:
                chunks.append(chunk_str)

            # Keep 15% overlap from end of current_sentences
            overlap_target = int(max_tokens * overlap_pct)
            retained: List[str] = []
            retained_tokens = 0
            for s in reversed(current_sentences):
                st = _estimate_tokens(s)
                if retained_tokens + st <= overlap_target or not retained:
                    retained.insert(0, s)
                    retained_tokens += st
                else:
                    break
            current_sentences = retained
            current_tokens = retained_tokens

        current_sentences.append(sent)
        current_tokens += sent_tokens

    if current_sentences:
        final_str = " ".join(current_sentences).strip()
        if final_str:
            chunks.append(final_str)

    return chunks if chunks else [text]


def chunk_resume(
    resume_id: str,
    user_id: str,
    raw_text: str,
    parsed_profile: Dict[str, Any],
) -> List[ResumeChunkCreate]:
    """
    Chunk resume by section and job/project entry (200-400 tokens, 15% overlap) with extracted technology tags (§2.3).
    Guarantees user isolation with user_id and resume_id.
    """
    chunks: List[ResumeChunkCreate] = []
    chunk_index = 0

    known_skills: List[str] = (
        parsed_profile.get("technical_skills")
        or parsed_profile.get("skills")
        or []
    )

    # 1. Summary Section (if present)
    summary_text = parsed_profile.get("summary")
    if summary_text and len(summary_text.strip()) > 30:
        clean_summary = summary_text.strip()
        tags = extract_tags_from_text(clean_summary, known_skills)
        chunks.append(
            ResumeChunkCreate(
                user_id=user_id,
                resume_id=resume_id,
                section="summary",
                text=f"Candidate Summary: {clean_summary}",
                tags=tags,
                chunk_index=chunk_index,
                token_count=_estimate_tokens(clean_summary),
            )
        )
        chunk_index += 1

    # 2. Skills Section
    if known_skills:
        skills_str = ", ".join(known_skills)
        skills_chunk_text = f"Technical Skills & Competencies: {skills_str}"
        tags = extract_tags_from_text(skills_chunk_text, known_skills)
        chunks.append(
            ResumeChunkCreate(
                user_id=user_id,
                resume_id=resume_id,
                section="skills",
                text=skills_chunk_text,
                tags=tags,
                chunk_index=chunk_index,
                token_count=_estimate_tokens(skills_chunk_text),
            )
        )
        chunk_index += 1

    # 3. Work History / Experience Entries (Individual Chunk per Job Role)
    work_history = (
        parsed_profile.get("work_history")
        or parsed_profile.get("experience")
        or []
    )

    for item in work_history:
        company = item.get("company", "Company")
        title = item.get("title", "Software Engineer")
        start = item.get("start") or item.get("duration") or ""
        end = item.get("end") or ""
        dates = f"{start} - {end}".strip(" -") if end else start

        highlights = item.get("highlights") or []
        description = item.get("description") or ""

        bullets = []
        if isinstance(highlights, list) and highlights:
            bullets.extend([f"• {h}" for h in highlights if h])
        elif description:
            bullets.append(description)

        entry_body = "\n".join(bullets)
        full_entry_text = f"Work Experience at {company} as {title} ({dates}):\n{entry_body}".strip()

        token_len = _estimate_tokens(full_entry_text)
        if token_len > 400:
            sub_chunks = _split_long_text(full_entry_text, max_tokens=350, overlap_pct=0.15)
            for sc in sub_chunks:
                tags = extract_tags_from_text(sc, known_skills)
                chunks.append(
                    ResumeChunkCreate(
                        user_id=user_id,
                        resume_id=resume_id,
                        section="experience",
                        text=sc,
                        tags=tags,
                        chunk_index=chunk_index,
                        token_count=_estimate_tokens(sc),
                    )
                )
                chunk_index += 1
        else:
            tags = extract_tags_from_text(full_entry_text, known_skills)
            chunks.append(
                ResumeChunkCreate(
                    user_id=user_id,
                    resume_id=resume_id,
                    section="experience",
                    text=full_entry_text,
                    tags=tags,
                    chunk_index=chunk_index,
                    token_count=token_len,
                )
            )
            chunk_index += 1

    # 4. Education Entries
    education_entries = parsed_profile.get("education") or []
    for edu in education_entries:
        institution = edu.get("institution") or edu.get("school") or ""
        degree = edu.get("degree") or ""
        year = edu.get("year") or edu.get("dates") or ""
        edu_text = f"Education: {degree} from {institution} ({year})".strip()
        tags = extract_tags_from_text(edu_text, known_skills)
        chunks.append(
            ResumeChunkCreate(
                user_id=user_id,
                resume_id=resume_id,
                section="education",
                text=edu_text,
                tags=tags,
                chunk_index=chunk_index,
                token_count=_estimate_tokens(edu_text),
            )
        )
        chunk_index += 1

    # 5. Fallback if structured profile was empty or produced < 2 chunks: chunk raw_text
    if len(chunks) < 2 and raw_text and len(raw_text.strip()) > 50:
        raw_sub_chunks = _split_long_text(raw_text.strip(), max_tokens=300, overlap_pct=0.15)
        for rc in raw_sub_chunks:
            # Guess section based on content keywords
            sec: ChunkSection = "general"
            rc_lower = rc.lower()
            if "skill" in rc_lower:
                sec = "skills"
            elif "experience" in rc_lower or "employed" in rc_lower or "engineer" in rc_lower:
                sec = "experience"
            elif "education" in rc_lower or "university" in rc_lower or "degree" in rc_lower:
                sec = "education"
            elif "project" in rc_lower:
                sec = "project"

            tags = extract_tags_from_text(rc, known_skills)
            chunks.append(
                ResumeChunkCreate(
                    user_id=user_id,
                    resume_id=resume_id,
                    section=sec,
                    text=rc,
                    tags=tags,
                    chunk_index=chunk_index,
                    token_count=_estimate_tokens(rc),
                )
            )
            chunk_index += 1

    return chunks

