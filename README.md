# Mock-interview simulator

An enterprise-grade, privacy-first AI mock interview platform where candidates upload resumes, select role and seniority, and participate in live adaptive interviews with real-time behavioral telemetry, automated question adaptation, and multi-dimensional scoring.

---

## 1. System Architecture

```text
Browser Client (React 18 + TypeScript)
 ├── Single Media Session ──► MediaStreamProvider (Camera + Audio Handover)
 ├── Background Vision ──► MediaPipe WASM (FaceLandmarker 30 FPS, PoseLandmarker 10-15 FPS)
 ├── Local Telemetry ────► MetricAggregator (Eye Contact, Posture, Expressions, Flags)
 ├── Audio Capture ──────► Web Speech Recognition (Real-Time Transcript Chunks)
 └── UI Engine ──────────► Responsive HUD, Background Video (2x2 px), PiP Self-View Toggle
                                 │
                                 │ WebSocket (?token=<JWT>)
                                 ▼
FastAPI ASGI Backend (Python 3.11+)
 ├── REST API: Argon2id Auth, Resumes (pdfplumber), Sessions, Evaluations
 ├── WebSocket Server: 10s Heartbeat, Telemetry Ingestion & HMAC Verification
 ├── LangGraph State Machine: Dynamic Difficulty Adaptation & Follow-Up Synthesis
 └── MongoDB Atlas (Motor): Database `ai-mock-interview` (Auth, Sessions, Telemetry, Reports)
```

### Privacy-First Principle
**Raw video and audio streams never leave the candidate's browser.** All computer vision inferences (MediaPipe FaceLandmarker with 478 3D mesh points and PoseLandmarker with 33 skeletal keypoints) execute 100% client-side inside WebAssembly. Only anonymized scalar metric aggregates (e.g., eye contact ratio, posture score, distraction flags) and speech transcripts are transmitted to the server.

---

## 2. Key Features & Engineering Highlights

### 2.1 Single Media Session & Stream Handover (`MediaStreamProvider`)
- **Single `getUserMedia` Invariant:** The platform requests camera and microphone access exactly once during the pre-interview setup.
- **Zero-Teardown Handover:** Video and audio streams are preserved via `retainForInterview()` and handed over to the live interview room without stopping tracks or causing black camera boxes.
- **Diagnostics Collector:** Tracks and counts all media acquisition events to prevent redundant hardware re-acquisitions.

### 2.2 Background Local Vision & Optimized Inference
- **Background Video Element:** In the live interview room, the camera feed is processed in the background using a rendered 2x2 px off-canvas video element. The element remains in the active DOM to prevent browser frame freezing and throttling.
- **`requestVideoFrameCallback` Support:** Synchronizes frame processing directly with hardware presentation, falling back smoothly to `requestAnimationFrame`.
- **Throttled Dual-Inference Pipeline:**
  - **FaceLandmarker:** Runs at full ~30 FPS for accurate gaze and facial expression monitoring.
  - **PoseLandmarker:** Throttled to 10–15 FPS (~80ms intervals) to conserve CPU/GPU resources while maintaining responsive posture tracking.
- **Toggleable Self-View Preview (PiP):** Candidates can open a compact picture-in-picture preview to inspect their framing at any time without unmounting or restarting the MediaPipe video pipeline.

### 2.3 Honest Real-Time Telemetry & Metrics
- **Zero Fake Defaults:** All metrics are strictly nullable (`number | null`). No hardcoded placeholder values (such as fake 85% defaults).
- **Instant Lens Cover Detection:** If the camera lens is covered or the candidate steps away, metrics immediately switch to `"—"` and `"Face not detected"`, triggering the `face_missing` distraction flag within 2 seconds.
- **1 Hz Telemetry Buckets:** Metric frames are aggregated into 1-second sample packets containing eye contact ratios, smoothed posture scores, head pose angles, and distraction flags (`face_missing`, `looked_away`, `slouching`, `fidgeting`).

### 2.4 Hardware Watchdog & Anti-Spoofing
- **Virtual Camera Blocklist:** Rejects software cameras (OBS Virtual Camera, ManyCam, EpocCam, Camo, etc.) and virtual loopback feeds.
- **Passive Anti-Spoofing:** Analyzes landmark jitter, micro-movements, eye blink rates, luminance variance, and 3D facial depth to detect printed photos, static screens, or looped video feeds.
- **Active Liveness Challenges:** Cryptographically seeded dynamic gesture verification (nod, smile, turn head, blink).
- **Hardware Watchdog:** Listens for track termination, mute events, device changes, and frame starvation with a 30-second grace recovery window.

### 2.5 MongoDB Atlas Persistence
- **Dedicated Database:** Connected to MongoDB Atlas under database `ai-mock-interview`.
- **Collections:**
  - `auth`: Stores candidate credentials with Argon2id password hashing and normalized email indexes.
  - `resumes`: Stores parsed candidate resume metadata and extracted skills.
  - `sessions`: Stores interview configurations, target roles, seniority tiers, and state.
  - `telemetry_samples`: 60-second bucketized time-series samples.
  - `evaluations`: Comprehensive scoring reports and question-by-question breakdowns.

### 2.6 Executive PDF Reporting (`@react-pdf/renderer`)
- Candidates and interviewers can download an official executive interview report containing overall scores, technical accuracy, communication clarity, behavioral composure, and an audit trail of integrity events.

---

## 3. Directory Layout

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
│   ├── scripts/
│   │   ├── check_db.py         # MongoDB connection verification script
│   │   └── verify_auth_db.py   # Full auth database CRUD verification script
│   ├── tests/                  # Pytest test suite (unit & integration)
│   ├── Dockerfile              # Multi-stage Python 3.11 image
│   └── requirements.txt        # Pinned production dependencies
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── ui/             # shadcn/ui primitives (Button, Card, Badge)
    │   │   ├── interview/      # WebcamMonitor, MetricsHUD, PreInterviewSetup, InterviewRoom
    │   │   └── report/         # PDFReportDocument (@react-pdf/renderer)
    │   ├── context/            # CameraStreamContext / MediaStreamProvider
    │   ├── hooks/              # useMediaPipeVision, useWebSocketInterview, useSpeechRecognition
    │   ├── lib/                # Telemetry aggregators, API clients, strict types
    │   ├── pages/              # AuthPage, DashboardPage
    │   └── App.tsx             # Root application component
    ├── public/models/          # MediaPipe task models (face_landmarker & pose_landmarker)
    ├── tests/                  # Vitest test suite (161 unit & integration tests)
    ├── package.json            # Pinned frontend dependencies
    └── vite.config.ts          # Vite build & proxy configuration
```

---

## 4. Quickstart & Local Setup

### Prerequisites
- Node.js 20+
- Python 3.11+
- MongoDB Atlas cluster or local MongoDB instance

---

### Step 1: Environment Configuration

Copy environment templates in both root and backend directories:
```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

Ensure `backend/.env` contains your MongoDB Atlas connection string:
```dotenv
MONGODB_URI="mongodb+srv://<USERNAME>:<PASSWORD>@cluster0.qmgryia.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
MONGODB_DB_NAME="ai-mock-interview"
MONGODB_TEST_DB_NAME="ai-mock-interview-test"
SECRET_KEY="generate-a-secure-random-32-byte-secret"
GEMINI_API_KEY="your-gemini-api-key"
```

Verify your MongoDB Atlas connection:
```bash
cd backend
python -m scripts.check_db
```

Verify auth database operations (insert, query, verify, cleanup):
```bash
python -m scripts.verify_auth_db
```

---

### Step 2: Backend Execution

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The backend starts at `http://localhost:8000`.
- API Health Probe: `http://localhost:8000/health`
- Database Health Probe: `http://localhost:8000/health/db`
- Interactive Swagger Docs: `http://localhost:8000/docs`

---

### Step 3: Frontend Execution

```bash
cd frontend
npm install
npm run dev
```

The frontend development server starts at `http://localhost:5173`.

---

## 5. Testing & Verification

### Frontend Test Suite (Vitest)
Run all 161 automated frontend unit and integration tests:
```bash
cd frontend
npm test
```

Run TypeScript strict type checking:
```bash
npm run lint
```

### Backend Test Suite (Pytest)
```bash
cd backend
pytest
```

---

## 6. Camera Integrity & Security Model

### Layered Defense Architecture
1. **Strict Physical Acquisition:** Filters virtual cameras and replayed loopback drivers via `virtualCameraBlocklist.ts`.
2. **Client-Side WASM Vision:** 100% of video processing occurs inside WebAssembly. Raw video frames are never stored, streamed, or uploaded.
3. **Passive & Active Anti-Spoofing:** Evaluates landmark micro-jitter, natural eye blinks, luminance variation, and dynamic challenges to verify physical presence.
4. **HMAC-SHA256 Signed Telemetry:** Telemetry packets carry monotonic sequence numbers (`seq`) signed with backend-issued session keys.
5. **Human Review Protocol:** Flagged anomaly events are stored transparently in the interview report alongside transcripts for interviewer review.

---

## 7. Microphone Troubleshooting & Acquisition Guide

If you experience `"Unable to connect to microphone device"` or an error during pre-interview audio setup, consult the steps below:

### 7.1 Operating System Permission Paths

#### Windows 10 & 11
1. Open **Windows Settings** (`Win + I`) → **Privacy & security** → **Microphone**.
2. Ensure **Microphone access** is turned **On**.
3. Ensure **Let apps access your microphone** is turned **On**.
4. Scroll down to **Let desktop apps access your microphone** and verify it is turned **On**. Both Google Chrome and Microsoft Edge require this setting.
5. If using a third-party antivirus or endpoint protection suite (Kaspersky, Bitdefender, Norton), verify that its "Webcam & Microphone Protection" feature is not actively blocking browser audio capture.

#### macOS (Ventura, Sonoma, Sequoia)
1. Open **System Settings** → **Privacy & Security** → **Microphone**.
2. Locate your browser (**Google Chrome**, **Microsoft Edge**, or **Brave**) in the application list and toggle the switch to **On**.
3. If the browser is open, quit and restart the browser for permission updates to take effect.

---

### 7.2 Browser Site Permissions (Chrome & Edge)
1. Click the **Tune / Lock** icon located immediately to the left of the URL in your browser's address bar.
2. In the site settings dropdown, verify that **Microphone** is explicitly set to **Allow** (not "Block" or "Ask").
3. Alternatively, navigate directly to `chrome://settings/content/microphone` (Chrome) or `edge://settings/content/microphone` (Edge) and confirm that this domain is listed under **"Allowed to use your microphone"**.
4. Reload the page after updating permissions.

---

### 7.3 Resolving Device Busy & Exclusive Mode Conflicts (`NotReadableError` / `AbortError`)
Windows devices and certain USB audio interfaces restrict simultaneous microphone access:
1. **Close Competing Applications:** Ensure apps such as Zoom, Microsoft Teams, Google Meet, Discord, Skype, OBS Studio, Audacity, or other browser tabs with open audio streams are closed.
2. **Disable Windows Exclusive Mode:**
   - Press `Win + R`, type `mmsys.cpl`, and press **Enter** to open the Sound Control Panel.
   - Navigate to the **Recording** tab, select your microphone, and click **Properties**.
   - Select the **Advanced** tab.
   - Uncheck **"Allow applications to take exclusive control of this device"**.
   - Click **Apply**, then **OK**, and reload the interview setup page.

---

### 7.4 System Default Audio Input Device & Web Speech API
- The browser Web Speech API (`webkitSpeechRecognition`) connects strictly to the operating system's **default communication microphone**. Unlike `getUserMedia`, the speech recognition engine cannot be redirected to a custom device identifier via code.
- **Windows:** Go to **Settings → System → Sound**. Under **Input**, select your preferred physical microphone and ensure it is designated as the **Default Device**.
- **macOS:** Go to **System Settings → Sound → Input** and click your preferred physical microphone.

---

### 7.5 Bluetooth Headsets & Hands-Free Audio Bandwidth
- When a Bluetooth headset (Apple AirPods, Sony WH-1000XM, Bose QC, Jabra) activates its microphone, the Bluetooth stack switches from high-fidelity A2DP stereo playback to the **Hands-Free Profile (HFP/SCO)**, reducing microphone sampling bandwidth to 8 kHz or 16 kHz.
- This profile switch can introduce audio latency, muffled frequency response, or momentary driver re-initialization.
- For optimal speech-to-text accuracy and lower latency during technical interviews, a wired 3.5mm headset or a dedicated USB condenser microphone is recommended.

---

### 7.6 Speech Recognition Connectivity
- Spoken responses are transcribed using your browser's speech recognition engine (in Chromium browsers, this routes through Google speech recognition servers).
- An active internet connection is required. If running inside an enterprise corporate network, ensure that outbound access to speech recognition endpoints (`*.googleapis.com`) is not restricted by corporate proxy inspection or firewall policies.

---

## 8. License

MIT License. Designed and engineered for privacy-preserving AI mock interview simulations.
