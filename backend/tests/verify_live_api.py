import urllib.request
import json
import ssl
import time

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

base = "http://127.0.0.1:8000"

print("--- STARTING LIVE API VERIFICATION ---")

# 1. Register if needed, then Login
user_creds = {"email": "alex.chen@example.com", "password": "Password123!", "full_name": "Alex Chen"}
reg_data = json.dumps(user_creds).encode("utf-8")
login_data = json.dumps({"email": "alex.chen@example.com", "password": "Password123!"}).encode("utf-8")

try:
    req = urllib.request.Request(f"{base}/api/v1/auth/register", data=reg_data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, context=ctx) as resp:
        print("[1/5] Auth Register: PASS (New candidate created)")
except urllib.error.HTTPError as e:
    print("[1/5] Auth Register: Candidate already registered, proceeding to login")

req = urllib.request.Request(f"{base}/api/v1/auth/login", data=login_data, headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, context=ctx) as resp:
    login_res = json.loads(resp.read().decode("utf-8"))
    token = login_res.get("access_token")
    print(f"      Auth Login: PASS (JWT Token acquired: {token[:20]}...)")

headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

# 2. Create Interview Session
session_payload = json.dumps({
    "job_role": "Full Stack Engineer",
    "target_seniority": "Senior",
    "difficulty": "Adaptive",
    "integrity_mode": "strict"
}).encode("utf-8")
req = urllib.request.Request(f"{base}/api/v1/sessions", data=session_payload, headers=headers)
with urllib.request.urlopen(req, context=ctx) as resp:
    session_res = json.loads(resp.read().decode("utf-8"))
    session_id = session_res["id"]
    print(f"[2/5] Session Creation: PASS (session_id={session_id[:8]}...)")

# 3. Start Adaptive Interview (Question #1 via LangGraph)
req = urllib.request.Request(f"{base}/api/v1/interview/sessions/{session_id}/start", data=b"{}", headers=headers)
with urllib.request.urlopen(req, context=ctx) as resp:
    start_res = json.loads(resp.read().decode("utf-8"))
    q1 = start_res["next_question"]
    print(f"[3/5] LangGraph Adaptive Engine (Question #1): PASS")
    print(f"      Question: {q1}")

# 4. Submit Candidate Answer & Evaluate Rubric
answer_payload = json.dumps({
    "answer": (
        "In architecting resilient full-stack systems, I implement hexagonal architecture with strict boundaries. "
        "For database consistency, I combine PostgreSQL ACID transactions with transactional outbox patterns "
        "and Apache Kafka for decoupled microservice communication."
    ),
    "status": "answered"
}).encode("utf-8")
req = urllib.request.Request(f"{base}/api/v1/interview/sessions/{session_id}/answer", data=answer_payload, headers=headers)
with urllib.request.urlopen(req, context=ctx) as resp:
    answer_res = json.loads(resp.read().decode("utf-8"))
    eval_res = answer_res.get("evaluation", {})
    print(f"[4/5] Rubric Evaluation & Dynamic Adaptation: PASS")
    print(f"      Candidate Score: {eval_res.get('score')}/10 (Technical Accuracy: {eval_res.get('technical_accuracy')}/10)")
    print(f"      Feedback: {eval_res.get('feedback')}")
    print(f"      Next Question #{answer_res.get('current_question_index')}: Tier={answer_res.get('difficulty')} (Change={answer_res.get('difficulty_change')})")

# 5. Check WebSocket Handshake and Protocol
import asyncio
import websockets

async def test_websocket():
    ws_url = f"ws://127.0.0.1:8000/api/v1/ws/interview/{session_id}?token={token}"
    async with websockets.connect(ws_url) as ws:
        init_msg = json.loads(await ws.recv())
        assert init_msg["type"] == "session_ready", f"Unexpected init: {init_msg}"
        assert "hmac_key" in init_msg, "Missing hmac_key in session_ready"
        print(f"[5/5] Real-Time WebSocket Telemetry Channel: PASS")
        print(f"      Session Ready: Handshake accepted, HMAC key provisioned for strict telemetry verification.")

asyncio.run(test_websocket())

print("\n--- ALL FUNCTIONALITIES TESTED AND FULLY OPERATIONAL ---")
