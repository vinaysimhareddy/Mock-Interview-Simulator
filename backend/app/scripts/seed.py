"""Database seed script populating demo candidate, resume, and completed interview session."""

import asyncio
from datetime import datetime, timezone
import logging
from app.core.database import get_database
from app.core.security import hash_password

logger = logging.getLogger("seed")


async def run_seed() -> None:
    print("🌱 Running database seed...")
    db = await get_database()

    now = datetime.now(timezone.utc)
    user_id = "seed-candidate-001"
    resume_id = "seed-resume-001"
    session_id = "seed-session-001"

    # 1. Seed Demo User
    existing_user = await db["users"].find_one({"email": "demo.candidate@adaptive-interview.com"})
    if not existing_user:
        user_doc = {
            "id": user_id,
            "email": "demo.candidate@adaptive-interview.com",
            "hashed_password": hash_password("CandidateDemo2026!"),
            "full_name": "Alex Rivers",
            "role": "candidate",
            "is_active": True,
            "created_at": now,
        }
        await db["users"].insert_one(user_doc)
        print("✅ Demo candidate user created: demo.candidate@adaptive-interview.com (password: CandidateDemo2026!)")
    else:
        user_id = existing_user["id"]
        print("ℹ️ Demo candidate already exists.")

    # 2. Seed Demo Resume
    existing_resume = await db["resumes"].find_one({"id": resume_id})
    if not existing_resume:
        resume_doc = {
            "id": resume_id,
            "user_id": user_id,
            "filename": "alex_rivers_staff_systems_engineer.pdf",
            "file_size": 128450,
            "raw_text": (
                "Alex Rivers - Staff Distributed Systems Engineer. "
                "Technical Skills: Python, Go, TypeScript, Kafka, Docker, Kubernetes, PostgreSQL, MongoDB, Redis, AWS, System Design, Concurrency. "
                "Experience: Lead Architect at CloudScale Inc (2021-Present), Senior Backend Engineer at FinTech Global (2018-2021). "
                "Education: B.S. in Computer Science, University of California, Berkeley."
            ),
            "parsed_data": {
                "skills": [
                    "Python", "Go", "TypeScript", "Kafka", "Docker",
                    "Kubernetes", "PostgreSQL", "MongoDB", "Redis", "System Design", "Concurrency"
                ],
                "experience": [
                    {
                        "title": "Lead Architect",
                        "company": "CloudScale Inc",
                        "duration": "2021 - Present",
                        "description": "Architected event-driven streaming platform handling 250,000 events/sec with sub-50ms p99 SLA."
                    },
                    {
                        "title": "Senior Backend Engineer",
                        "company": "FinTech Global",
                        "duration": "2018 - 2021",
                        "description": "Led ledger reconciliation engine with zero dual-write discrepancy using transactional outbox."
                    }
                ],
                "education": [
                    {
                        "degree": "B.S. in Computer Science",
                        "institution": "University of California, Berkeley",
                        "year": "2018"
                    }
                ],
                "summary": "Staff-level systems engineer specializing in high-throughput distributed event streaming, fault-tolerant consistency, and resilient microservice architectures."
            },
            "created_at": now,
        }
        await db["resumes"].insert_one(resume_doc)
        print("✅ Demo parsed resume created.")
    else:
        print("ℹ️ Demo resume already exists.")

    # 3. Seed Completed Interview Session with Evaluations and Final Report
    existing_session = await db["sessions"].find_one({"id": session_id})
    if not existing_session:
        final_report = {
            "overall_score": 88.5,
            "category_scores": {
                "technical": 91.0,
                "communication": 85.0,
                "composure": 87.0
            },
            "hiring_recommendation": "Strong Hire",
            "strengths": [
                "Exceptional depth in distributed systems, idempotency patterns, and partition handling.",
                "Articulated complex architectural trade-offs with structured clarity and quantitative benchmarks.",
                "Maintained steady eye contact (87% alignment) and calm physiological composure throughout staff-tier questions."
            ],
            "weaknesses": [
                "Could expand on automated canary analysis and automated rollback trigger criteria in CI/CD pipeline."
            ],
            "executive_summary": (
                "Candidate Alex Rivers completed 5 adaptive interview questions for Staff Distributed Systems Engineer. "
                "Demonstrated staff-level mastery across asynchronous event streaming, consensus, and resilience patterns. "
                "Recommendation: Strong Hire (Overall Score: 88.5/100)."
            )
        }

        conversation_history = [
            {"role": "interviewer", "content": "To begin our technical discussion for Staff Distributed Systems Engineer, walk me through an event-driven architecture you owned using Kafka and Redis."},
            {"role": "candidate", "content": "We built an ingestion pipeline processing 250k events/sec. We used Kafka with partition key hashing and Debezium CDC with the transactional outbox pattern to guarantee zero message loss without distributed locking."},
            {"role": "interviewer", "content": "How did you handle consumer group rebalancing and poison pill message dead-letter routing under heavy load?"},
            {"role": "candidate", "content": "We deployed cooperative sticky assignors in Kafka to minimize partition revocation pauses during rolling deploys, and routed deserialization failures to an exponential retry topic before dead-letter storage."},
            {"role": "interviewer", "content": "Suppose network partitions occur between your Redis primary and replica during a failover. How do you defend against split-brain writes?"},
            {"role": "candidate", "content": "We enforce Redis Sentinel quorum rules and configured min-replicas-to-write 1 with min-replicas-max-lag 10s so the partition minority rejects stale writes immediately."},
            {"role": "interviewer", "content": "How do you achieve zero-downtime database schema migrations on tables with hundreds of millions of rows?"},
            {"role": "candidate", "content": "We follow expand-and-contract migrations: first add nullable columns, dual-write in application code, backfill historical rows via batched background jobs, and then drop old columns."},
            {"role": "interviewer", "content": "Reflecting on your architectural experience, describe a critical production incident you mitigated and the preventative safeguards implemented."},
            {"role": "candidate", "content": "Downstream timeouts caused thread starvation on our API gateway. We introduced adaptive circuit breaking with Envoy, request deadline propagation via gRPC, and client-side jitter backoff."}
        ]

        evaluations_history = [
            {"score": 9.2, "technical_accuracy": 9.5, "clarity": 9.0, "completeness": 9.0, "feedback": "Superb explanation of transactional outbox and event streaming."},
            {"score": 8.8, "technical_accuracy": 9.0, "clarity": 8.5, "completeness": 9.0, "feedback": "Cooperative sticky assignor choice shows high familiarity with modern Kafka internals."},
            {"score": 8.5, "technical_accuracy": 8.8, "clarity": 8.5, "completeness": 8.2, "feedback": "Accurate application of min-replicas-to-write to prevent split-brain writes."},
            {"score": 8.9, "technical_accuracy": 9.2, "clarity": 8.8, "completeness": 8.7, "feedback": "Textbook expand-contract schema migration pattern."},
            {"score": 8.8, "technical_accuracy": 9.0, "clarity": 8.8, "completeness": 8.6, "feedback": "Clear root cause isolation with deadline propagation and circuit breakers."}
        ]

        session_doc = {
            "id": session_id,
            "user_id": user_id,
            "resume_id": resume_id,
            "role": "Staff Distributed Systems Engineer",
            "seniority": "Senior",
            "difficulty": "Staff",
            "status": "COMPLETED",
            "current_question_index": 5,
            "started_at": now,
            "ended_at": now,
            "created_at": now,
            "interview_state": {
                "session_id": session_id,
                "user_id": user_id,
                "role": "Staff Distributed Systems Engineer",
                "seniority": "Senior",
                "difficulty": "Staff",
                "current_question_index": 5,
                "max_questions": 5,
                "is_finished": True,
                "conversation_history": conversation_history,
                "evaluations_history": evaluations_history,
                "difficulty_history": ["Medium", "Hard", "Hard", "Staff", "Staff"],
                "final_report": final_report,
            }
        }
        await db["sessions"].insert_one(session_doc)

        # Seed in interview_reports
        await db["interview_reports"].insert_one({
            "session_id": session_id,
            "user_id": user_id,
            "created_at": now,
            "report": final_report,
        })
        print("✅ Demo completed interview session and scorecard seeded.")
    else:
        print("ℹ️ Demo interview session already exists.")

    print("🎉 Database seed finished successfully!")


if __name__ == "__main__":
    asyncio.run(run_seed())
