# Mock-interview simulator

An enterprise-grade, privacy-first web application where candidates upload resumes, select role and seniority, and participate in live adaptive AI mock interviews. 

The client runs computer vision inference locally with MediaPipe WASM (tracking gaze, posture, head pose, and distraction flags) and transmits 1 Hz scalar telemetry packets over WebSockets alongside speech transcripts. A LangGraph state machine dynamically adapts interview difficulty and generates follow-up questions, culminating in an actionable multi-dimensional evaluation report downloadable as PDF.

---

## 1. System Architecture

```text
Browser Client (React 18 + TypeScript)
 ├── Webcam ──► MediaPipe WASM (30 FPS, Local) ──► MetricAggregator ──► 1 Hz Telemetry ──┐
 ├── Microphone ──► Web Speech Recognition ──► Transcript Chunks ────────────────────────┤
 └── UI ◄────────── Adaptive Questions / Feedback ◄──────────────────────────────────────┤
                                                               WebSocket (?token=<JWT>)  │
FastAPI ASGI Backend (Python 3.11+) ◄────────────────────────────────────────────────────┘
 ├── REST API: Auth, Resumes (pdfplumber), Sessions, Evaluations
 ├── WebSocket Ingestion & 10s Heartbeat/Buffer Flusher
 ├── LangGraph State Machine (Adaptive Engine via Gemini / OpenAI)
 └── MongoDB (Async Motor): Users, Resumes, Sessions, Bucketized Telemetry, Evaluations
```

### Privacy Principle
**Raw video never leaves the browser.** All vision inference (FaceLandmarker 478 points, PoseLandmarker 33 points) runs entirely on the client via WebAssembly. Only scalar aggregates and text transcripts are transmitted to the server.

---

## 2. Directory Layout

```text
.
├── docker-compose.yml          # Multi-container orchestration (Mongo, Backend, Frontend)
├── .env.example                # Environment variables template
├── README.md                   # Comprehensive documentation and runbooks
├── backend/
│   ├── app/
│   │   ├── api/v1/
│   │   │   ├── endpoints/      # REST route handlers (auth, resumes, sessions, evaluations)
│   │   │   ├── websocket.py    # WebSocket connection manager and protocol handlers
│   │   │   └── router.py       # API v1 router definition
│   │   ├── core/
│   │   │   ├── config.py       # Pydantic v2 BaseSettings configuration
│   │   │   ├── database.py     # Motor async MongoDB client & lifecycle
│   │   │   └── security.py     # Argon2id hashing & PyJWT token utilities
│   │   ├── models/             # Domain entities and discriminated union schemas
│   │   ├── services/           # LangGraph engine, pdfplumber, evaluation rubrics
│   │   └── main.py             # ASGI entrypoint with CORS and /health check
│   ├── tests/                  # Pytest test suite (unit & integration)
│   ├── Dockerfile              # Multi-stage Python 3.11 image
│   └── requirements.txt        # Pinned production dependencies
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── ui/             # shadcn/ui primitives (Button, Card, Badge)
    │   │   ├── interview/      # WebcamMonitor, LiveTranscript, QuestionCard, MetricsHUD
    │   │   └── report/         # PDFReportDocument (@react-pdf/renderer)
    │   ├── hooks/              # useMediaPipeVision, useWebSocketInterview, useSpeechRecognition
    │   ├── lib/                # Telemetry aggregators, API clients, strict types
    │   ├── pages/              # Login, Dashboard, InterviewRoom, ReportView
    │   └── App.tsx             # Root application component
    ├── public/models/          # MediaPipe task models (face & pose)
    ├── Dockerfile              # Node.js Alpine development container
    └── package.json            # Pinned frontend dependencies
```

---

## 3. Quickstart & Local Execution

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/)
- Alternatively: Node.js 20+ and Python 3.11+ for running bare-metal

### Step 1: Environment Configuration & MongoDB Setup

#### MongoDB Atlas Setup
1. **Create Atlas Database User:**
   - In MongoDB Atlas, navigate to **Database Access** under Security.
   - Click **Add New Database User**, choose **Password Authentication**, and assign the `readWriteAnyDatabase` or `readWrite@ai-mock-interview` role.
2. **Configure Network Access:**
   - Navigate to **Network Access** under Security.
   - Click **Add IP Address** and add your current public IP address (or `0.0.0.0/0` for development / cloud containers).
3. **Copy Environment Template:**
   ```bash
   cp .env.example .env
   cp backend/.env.example backend/.env
   ```
4. **Set MONGODB_URI in `backend/.env`:**
   ```dotenv
   MONGODB_URI="mongodb+srv://<USERNAME>:<PASSWORD>@cluster0.qmgryia.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
   MONGODB_DB_NAME="ai-mock-interview"
   MONGODB_TEST_DB_NAME="ai-mock-interview-test"
   ```
   *(Note: If your password contains special characters, URL-encode them or provide `MONGODB_USERNAME` and `MONGODB_PASSWORD` separately).*
5. **Verify Connectivity with CLI Script:**
   ```bash
   cd backend
   python -m scripts.check_db
   ```
   *Expected Output:*
   ```text
   Connected successfully to cluster0.qmgryia.mongodb.net (latency: ~15ms)
   Active database: ai-mock-interview
   Existing collections: ['auth', 'resumes', 'interview_sessions', ...]
   Ensured required 'auth' collection exists.
   Database is healthy and ready.
   ```
6. **Database Architecture & Test Safety:**
   - Production operations read/write strictly from `ai-mock-interview`.
   - Automated tests run exclusively against `ai-mock-interview-test` (guarded by a safety exception that aborts tests if run against production).
   - Zero credentials in code, logs, or git commits.

#### Additional Configuration
Populate `GOOGLE_API_KEY` (or `OPENAI_API_KEY`) and review defaults:
```dotenv
JWT_SECRET="generate_a_random_32_character_hex_key_here"
JWT_EXPIRE_MINUTES=60
CORS_ORIGINS="http://localhost:5173,http://localhost:3000"
LLM_PROVIDER="google"
MAX_UPLOAD_MB=5
```

### Step 2: Running with Docker Compose
Start all three services (MongoDB, FastAPI backend with reload, Vite frontend):
```bash
docker compose up --build
```

Services will be accessible at:
- **Frontend UI:** [http://localhost:5173](http://localhost:5173)
- **Backend API:** [http://localhost:8000](http://localhost:8000)
- **Backend Health Check:** [http://localhost:8000/health](http://localhost:8000/health)
- **API Documentation (Swagger):** [http://localhost:8000/docs](http://localhost:8000/docs)
- **MongoDB:** `localhost:27017`

---

## 4. Verification Checklist

### Verification Commands & Expected Output
1. **Docker Compose Orchestration:**
   ```bash
   docker compose up --build -d
   docker compose ps
   ```
   *Expected:* All 3 services (`interview_mongo`, `interview_backend`, `interview_frontend`) report status `running` / `healthy`.

2. **Backend Health Check:**
   ```bash
   curl -i http://localhost:8000/health
   ```
   *Expected:*
   ```http
   HTTP/1.1 200 OK
   content-type: application/json
   {"status":"ok"}
   ```

3. **Backend Unit Tests:**
   ```bash
   PYTHONPATH=backend backend/venv/bin/pytest backend/tests/ -v
   ```
   *Expected:* All tests pass (`test_health_check_returns_ok PASSED`, `test_v1_ping_returns_pong PASSED`).

4. **Frontend Build & Lint:**
   ```bash
   npm run lint
   npm run build
   ```
   *Expected:* Clean compilation with no TypeScript or build errors.

---

### How to Confirm Auth is Stored in MongoDB

#### 1. Automated Guard Verification Script
Run the automated end-to-end verification script from the repository root:
```bash
python scripts/verify_auth_storage.py
```
*Expected Output:*
```text
=================================================================
MONGODB ATLAS AUTH STORAGE VERIFICATION
=================================================================
Target Atlas Host: cluster0.qmgryia.mongodb.net
Target Database:   ai-mock-interview
Auth Collection:   auth
PASS: Successfully connected and pinged MongoDB Atlas.
1. Registering unique user via API...
PASS: User registered via API with ID: <id>
2. Querying Atlas ai-mock-interview.auth directly...
PASS: User document found in MongoDB Atlas auth collection.
PASS: Password is encrypted with Argon2id ($argon2id$ format verified).
3. Authenticating via API login...
PASS: Successfully authenticated and received JWT access token.
4. Fetching user profile via GET /api/v1/auth/me...
PASS: User profile verified
5. Checking GET /health/db diagnostic endpoint...
PASS: /health/db confirmed: auth_document_count = <count>
6. Cleaning up test user document from Atlas...
PASS: Test user document deleted successfully from Atlas.
=================================================================
PASS: auth data is stored in ai-mock-interview.auth
=================================================================
```

#### 2. Manual MongoDB Atlas Web Console Verification
1. Log into your [MongoDB Atlas Dashboard](https://cloud.mongodb.com).
2. Under **Security** → **Network Access**, ensure your current public IP address (or `0.0.0.0/0`) is active.
3. Under **Deployment** → **Database**, click **Browse Collections** on your cluster.
4. Locate and expand the **`ai-mock-interview`** database.
5. Click the **`auth`** collection.
6. Verify document records:
   - `email`: Normalized, lowercase email address.
   - `hashed_password`: Argon2id hash starting with `$argon2id$` (never plaintext).
   - `full_name`: Candidate's full name.
   - `role`: `"candidate"` or `"admin"`.
   - `created_at` / `updated_at`: UTC timestamps.
   - Ensure the legacy `users` collection is not used.
7. Query database health via API:
   ```bash
   curl http://localhost:8000/health/db
   ```
   Returns `{"status": "ok", "database": "ai-mock-interview", "auth_collection_exists": true, "auth_document_count": <count>}`.

---

## 5. API Reference (Phase 1 Baseline)

| Method | Endpoint | Description | Expected Status |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Core ASGI server health probe | `200 OK` |
| `GET` | `/api/v1/ping` | API v1 namespace connectivity ping | `200 OK` |
| `GET` | `/docs` | OpenAPI / Swagger interactive documentation | `200 OK` |

---

## 6. Troubleshooting

- **Port Conflict on 8000:** Update `PORT` in `.env` and `docker-compose.yml` to another port (e.g., 8001).

---

## 7. Camera Integrity & Limitations

### 7.1 Architecture & Layered Defense
The platform enforces a physical-only webcam verification architecture designed to eliminate mock, synthetic, loopback, or replayed feeds while safeguarding candidate privacy:

1. **Strict Hardware Acquisition:**
   - Client requests raw physical camera media tracks via `navigator.mediaDevices.getUserMedia`.
   - Continuous device filtering with `virtualCameraBlocklist.ts` blocks OBS Virtual Camera, Camo, ManyCam, XSplit, EpocCam, and virtual loopback devices.
   - Rejects canvas streams, screen captures (`getDisplayMedia`), and file video sources.

2. **Client-Side WASM Vision (Privacy-First):**
   - MediaPipe FaceLandmarker (478 3D landmarks) and PoseLandmarker (33 points) run purely inside browser WebAssembly at 30 FPS.
   - Raw video frames NEVER leave the candidate's browser and are never uploaded or stored.
   - Client aggregates metrics into 1 Hz scalar telemetry packets.

3. **Passive & Active Anti-Spoofing:**
   - **Passive:** Monitors landmark jitter, natural micro-movements, eye blink blendshapes, downsampled frame difference variance, and depth consistency to detect static photos, frozen frames, or replayed monitors.
   - **Active:** Cryptographically seeded liveness challenges (random nonces, randomized gestures like nod, smile, blink twice, turn head) executed at setup and during the session.

4. **HMAC-SHA256 Signed Telemetry & Plausibility Engine:**
   - Telemetry packets carry monotonic sequence numbers (`seq`) and HMAC-SHA256 signatures using keys rotated every 5 minutes by the backend.
   - Server-side plausibility checks detect synthetic telemetry streams (identical consecutive values, zero jitter, impossible blink frequencies, or lip-movement/audio desynchronization).

5. **Verified Non-Verbal Scoring:**
   - Non-verbal scores (eye contact ratio, posture score) are computed strictly from verified-live segments. Segments with active integrity flags are excluded from candidate composure scores.

6. **Official Executive & PDF Reporting:**
   - Candidates and interviewers receive an executive verification verdict (`Verified`, `Verified with warnings`, or `Not verified`), a transparent timeline of audit events, and downloadable PDF reports generated via `@react-pdf/renderer`.

### 7.2 Realistic Security Model & Inherent Limitations
> [!IMPORTANT]
> **Deterrence and Detection vs. Absolute Guarantee:**
> Browser-based computer vision checks are engineered for **deterrence, automated screening, and behavioral integrity detection**, not an absolute guarantee of identity or tamper-proof physical containment.
> 
> - **Client-Side Boundaries:** A determined adversary with complete local root/admin access can run custom-patched browser engines, manipulate WebAssembly memory, or utilize hardware HDMI capture devices (e.g. video capture card feeding a re-broadcast feed).
> - **Automated Heuristics:** Integrity flags are heuristic indicators of anomaly. False positives may occur due to poor ambient lighting, low-end webcams, or candidate motor/speech variations (for which explicit accessibility accommodations are provided in setup).
> - **Review Protocol:** Flagged events should be reviewed by an interviewer or human administrator alongside the recorded interview transcript and question evaluations before drawing adverse employment conclusions.

