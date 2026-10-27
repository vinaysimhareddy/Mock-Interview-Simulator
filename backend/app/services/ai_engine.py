import logging
from typing import Optional
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import SystemMessage, HumanMessage

from app.core.config import get_settings
from app.models.resume import ParsedProfile

logger = logging.getLogger("uvicorn.error")
settings = get_settings()


class AIServiceError(Exception):
    """Exception raised when an AI provider call fails or exhausts retries."""
    pass


def get_llm(temperature: float = 0.1) -> BaseChatModel:
    """Instantiate configured LLM provider (OpenAI GPT-4o or Google Gemini)."""
    provider = settings.LLM_PROVIDER.lower().strip()
    if provider == "openai":
        from langchain_openai import ChatOpenAI

        from pydantic import SecretStr

        if not settings.OPENAI_API_KEY:
            raise AIServiceError("OPENAI_API_KEY is not configured in environment.")
        return ChatOpenAI(
            model="gpt-4o",
            api_key=SecretStr(settings.OPENAI_API_KEY),
            temperature=temperature,
            timeout=25.0,
            max_retries=1,
        )
    elif provider == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI

        if not settings.GOOGLE_API_KEY:
            raise AIServiceError("GOOGLE_API_KEY is not configured in environment.")
        return ChatGoogleGenerativeAI(
            model="gemini-3.5-flash-lite",
            google_api_key=settings.GOOGLE_API_KEY,
            temperature=temperature,
            timeout=25.0,
            max_retries=1,
        )
    else:
        raise AIServiceError(f"Unsupported LLM provider '{provider}'. Must be 'openai' or 'google'.")


RESUME_PARSER_SYSTEM_PROMPT = """You are an expert technical recruiter and resume analyzer.
Analyze the candidate's resume text and extract a comprehensive, structured profile.
Extract:
1. technical_skills: List of technical skills, languages, frameworks, developer tools, and databases.
2. experience_years: Estimated total professional experience in years (as a float).
3. work_history: Chronological list of roles with company name, job title, start date, end date (or 'Present'), and 2-4 key technical bullet highlights.

Be accurate and omit fabricated details."""


async def parse_resume_profile(
    raw_text: str, custom_llm: Optional[BaseChatModel] = None
) -> ParsedProfile:
    """
    Parse resume plaintext into a structured ParsedProfile using LangChain's with_structured_output.
    Executes with automatic retry logic (max 2 retries, total 3 attempts).
    Raises AIServiceError on persistent failure.
    """
    max_retries = 2
    attempts = 0
    last_error: Optional[Exception] = None

    while attempts <= max_retries:
        try:
            llm = custom_llm if custom_llm is not None else get_llm()
            structured_parser = llm.with_structured_output(ParsedProfile)

            messages = [
                SystemMessage(content=RESUME_PARSER_SYSTEM_PROMPT),
                HumanMessage(
                    content=f"Please extract the candidate's profile from this resume:\n\n{raw_text[:12000]}"
                ),
            ]

            result = await structured_parser.ainvoke(messages)
            if isinstance(result, ParsedProfile):
                return result
            elif isinstance(result, dict):
                return ParsedProfile(**result)
            else:
                raise AIServiceError(f"Unexpected parser output type: {type(result)}")
        except Exception as exc:
            attempts += 1
            last_error = exc
            logger.warning(
                "Resume parsing attempt %d/%d failed: %s",
                attempts,
                max_retries + 1,
                exc,
            )
            if attempts > max_retries:
                break

    raise AIServiceError(f"LLM resume parsing failed after {max_retries + 1} attempts: {last_error}")
