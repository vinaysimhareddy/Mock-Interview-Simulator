/**
 * Source of truth contracts and types matching backend Pydantic models.
 */

export type DistractionFlag = 'looked_away' | 'face_missing' | 'slouching' | 'fidgeting';

export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface ExpressionMetrics {
  smile: number;
  brow_furrow: number;
  mouth_open: number;
}

export interface IntegrityFlagItem {
  flag: string;
  confidence?: number;
}

export interface IntegrityPayload {
  camera_label_hash?: string;
  device_id_hash?: string;
  track_state?: string;
  resolution?: string;
  measured_fps?: number;
  frame_diff_mean?: number;
  landmark_jitter?: number;
  luminance_mean?: number;
  faces_detected?: number;
  flags?: Array<IntegrityFlagItem | string>;
  challenge?: Record<string, unknown>;
  seq?: number;
  hmac?: string;
}

export interface TelemetrySample {
  type: 'telemetry';
  t: number;                           // seconds since interview start
  eye_contact_ratio: number | null;     // 0..1 fraction looking at camera in 1s window, null if face not present
  posture_score: number | null;         // 0..1 posture quality score, null if face not present
  head_pose: HeadPose | null;
  expression: ExpressionMetrics | null;
  distraction_flags: DistractionFlag[];
  face_present: boolean;
  fps: number;
  integrity?: IntegrityPayload;
}

export interface FrameMetricSnapshot {
  timestamp: number;
  face_present: boolean;
  looking_at_camera: boolean;
  raw_posture_score: number;
  head_pose: HeadPose;
  expression: ExpressionMetrics;
  pose_keypoint_variance: number;
}

export interface CalibrationBaseline {
  neutralShoulderWidth: number;
  neutralShoulderSlope: number;
  neutralNoseY: number;
  neutralYaw: number;
  neutralPitch: number;
}

// ==============================================================================
// WebSocket Protocols (§4.2)
// ==============================================================================

export type ClientWSMessage =
  | TelemetrySample
  | { type: 'transcript_chunk'; text: string; is_final: boolean; t: number }
  | { type: 'answer_complete'; turn_id: string }
  | { type: 'end_interview'; reason?: string }
  | { type: 'ping'; timestamp?: number }
  | { type: 'pong'; timestamp?: number }
  | { type: 'challenge_result'; challenge_id: string; nonce: string; passed: boolean; score?: number }
  | { type: 'integrity_event'; event_type: string; details?: Record<string, unknown>; t?: number };

export type ServerWSMessage =
  | { type: 'session_ready'; session_id: string; message: string; hmac_key?: string; session_salt?: string }
  | { type: 'question'; turn_id: string; text: string; topic: string; difficulty: string }
  | { type: 'ack'; received_type: string; t?: number }
  | { type: 'interview_complete'; session_id: string; evaluation_id: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'ping'; timestamp?: number }
  | { type: 'pong'; timestamp?: number }
  | { type: 'pause_integrity'; reason: string; grace_seconds?: number; voice_prompt?: string }
  | { type: 'resume_integrity'; message: string }
  | { type: 'challenge'; challenge_id: string; action: string; prompt: string; nonce: string; timeout_sec?: number };

// ==============================================================================
// Domain Models (§4.4)
// ==============================================================================

export interface CandidateUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface WorkHistoryItem {
  company: string;
  title: string;
  start?: string;
  end?: string;
  highlights: string[];
}

export interface ParsedProfile {
  technical_skills: string[];
  experience_years: number;
  work_history: WorkHistoryItem[];
}

export interface ResumeRecord {
  id: string;
  user_id: string;
  filename: string;
  file_size: number;
  raw_text: string;
  parsed_profile: ParsedProfile;
  created_at: string;
}

export type SessionLifecycleStatus = 'created' | 'active' | 'completed' | 'aborted';

export interface TranscriptTurn {
  turn_id: string;
  role: 'interviewer' | 'candidate';
  text: string;
  t_start: number;
  t_end?: number;
}

export interface InterviewSessionRecord {
  id: string;
  user_id: string;
  resume_id?: string;
  job_role: string;
  target_seniority: string;
  session_status: SessionLifecycleStatus;
  transcript: TranscriptTurn[];
  started_at?: string;
  ended_at?: string;
  created_at: string;
}

export interface EvaluationRecord {
  id: string;
  session_id: string;
  technical_competency_score: number;
  communication_score: number;
  non_verbal_score: number;
  overall_score: number;
  dimension_breakdown: Record<string, { score: number; feedback: string }>;
  strengths: string[];
  improvements: string[];
  detailed_summary: string;
  created_at: string;
}

// ==============================================================================
// Integrity Report & Executive Scorecard (§7, R6)
// ==============================================================================

export type IntegrityVerdict = 'Verified' | 'Verified with warnings' | 'Not verified';

export interface IntegrityTimelineEvent {
  flag: string;
  timestamp: number;
  duration_sec: number;
  confidence: number;
  details?: Record<string, unknown>;
}

export interface IntegritySummary {
  verdict: IntegrityVerdict;
  integrity_score: number;
  camera_device_name: string;
  challenges_passed: number;
  challenges_failed: number;
  face_present_percentage: number;
  pauses_count: number;
  camera_loss_incidents: number;
  timeline_events: IntegrityTimelineEvent[];
  excluded_segments_count: number;
  non_verbal_excluded_note: string;
  disclaimer: string;
}

export interface FinalReport {
  overall_score: number;
  category_scores: {
    technical: number;
    communication: number;
    composure: number;
  };
  hiring_recommendation: string;
  strengths: string[];
  weaknesses: string[];
  executive_summary: string;
  integrity_summary?: IntegritySummary;
}

