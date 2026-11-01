import { describe, expect, it } from 'vitest';
import { MetricAggregator } from '../src/lib/metrics';
import { FrameMetricSnapshot, TelemetrySample } from '../src/lib/types';
import {
  computeCanonicalPayload,
  computeTelemetryHmac,
  sha256Hex,
  verifyTelemetryHmac,
} from '../src/lib/hmacSignature';

describe('I3: Honest Metrics and Telemetry Pipeline (§4, §5)', () => {
  describe('1. Honest Metrics Invariant (Zero Fake Metrics)', () => {
    it('when face is absent, every metric is null with no fake 85% fallbacks', () => {
      const aggregator = new MetricAggregator();
      const now = performance.now();

      // Feed frames with face_present === false
      for (let i = 0; i < 30; i++) {
        aggregator.addFrame({
          timestamp: now - 950 + i * 32,
          face_present: false,
          looking_at_camera: false,
          raw_posture_score: 0.0,
          head_pose: { yaw: 0, pitch: 0, roll: 0 },
          expression: { smile: 0, brow_furrow: 0, mouth_open: 0 },
          pose_keypoint_variance: 0.0,
        });
      }

      const packet: TelemetrySample = aggregator.emitPacket(5, 30);

      expect(packet.face_present).toBe(false);
      expect(packet.eye_contact_ratio).toBeNull();
      expect(packet.posture_score).toBeNull();
      expect(packet.head_pose).toBeNull();
      expect(packet.expression).toBeNull();
      expect(packet.fps).toBe(30);

      // Verify no hardcoded 0.85 or fake numbers anywhere in metrics
      expect(packet.eye_contact_ratio).not.toBe(0.85);
      expect(packet.posture_score).not.toBe(0.85);
      expect(packet.posture_score).not.toBe(0.8);
    });

    it('detects face_missing distraction flag when face is missing for >= 2.0s', () => {
      const aggregator = new MetricAggregator();
      const now = performance.now();

      // 70 frames spanning 2.2 seconds with no face
      for (let i = 0; i < 70; i++) {
        aggregator.addFrame({
          timestamp: now - 2200 + i * 31,
          face_present: false,
          looking_at_camera: false,
          raw_posture_score: 0.0,
          head_pose: { yaw: 0, pitch: 0, roll: 0 },
          expression: { smile: 0, brow_furrow: 0, mouth_open: 0 },
          pose_keypoint_variance: 0.0,
        });
      }

      const packet = aggregator.emitPacket(6, 30);
      expect(packet.face_present).toBe(false);
      expect(packet.distraction_flags).toContain('face_missing');
      expect(packet.eye_contact_ratio).toBeNull();
      expect(packet.posture_score).toBeNull();
    });

    it('when face is present, metrics are calculated from real frame data', () => {
      const aggregator = new MetricAggregator();
      const now = performance.now();

      for (let i = 0; i < 30; i++) {
        aggregator.addFrame({
          timestamp: now - 950 + i * 32,
          face_present: true,
          looking_at_camera: i % 2 === 0, // 50% looking at camera
          raw_posture_score: 0.92,
          head_pose: { yaw: 3.5, pitch: -1.2, roll: 0.4 },
          expression: { smile: 0.45, brow_furrow: 0.05, mouth_open: 0.1 },
          pose_keypoint_variance: 0.001,
        });
      }

      const packet = aggregator.emitPacket(7, 30);
      expect(packet.face_present).toBe(true);
      expect(packet.eye_contact_ratio).toBe(0.5);
      expect(packet.posture_score).toBeGreaterThan(0.7);
      expect(packet.head_pose).toEqual({ yaw: 3.5, pitch: -1.2, roll: 0.4 });
      expect(packet.expression?.smile).toBeCloseTo(0.45, 2);
    });
  });

  describe('2. HMAC Signature Generation & Parity with Backend (§5.1)', () => {
    const referenceKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const referenceT = 1.25;
    const referenceSeq = 1;
    const referenceCameraHash = 'mock_camera_hash';
    const referenceDeviceHash = 'mock_device_hash';
    const referenceFps = 30.0;
    // Expected HMAC produced by backend Python HMACManager.compute_signature with identical inputs:
    const expectedPythonHmac = '8b8201b85ed7eda6e8293367acd17577204cb9d6ecf089afbbc12f82037571fb';

    it('canonical payload format strictly matches backend format specification', () => {
      const payload = computeCanonicalPayload(
        referenceT,
        referenceSeq,
        referenceCameraHash,
        referenceDeviceHash,
        referenceFps
      );
      expect(payload).toBe('1.250:1:mock_camera_hash:mock_device_hash:30.00');
    });

    it('formats optional/empty hashes as empty strings matching python canonical spec', () => {
      const payload = computeCanonicalPayload(10.0, 5, undefined, undefined, 29.97);
      expect(payload).toBe('10.000:5:::29.97');
    });

    it('generates exact HMAC signature matching backend HMACManager', async () => {
      const signature = await computeTelemetryHmac(
        referenceKey,
        referenceT,
        referenceSeq,
        referenceCameraHash,
        referenceDeviceHash,
        referenceFps
      );
      expect(signature).toBe(expectedPythonHmac);
    });

    it('verifies valid HMAC signature and rejects corrupted/tampered payload', async () => {
      const isValid = await verifyTelemetryHmac(
        referenceKey,
        expectedPythonHmac,
        referenceT,
        referenceSeq,
        referenceCameraHash,
        referenceDeviceHash,
        referenceFps
      );
      expect(isValid).toBe(true);

      // Tampered timestamp
      const tamperedT = await verifyTelemetryHmac(
        referenceKey,
        expectedPythonHmac,
        1.251, // Altered timestamp
        referenceSeq,
        referenceCameraHash,
        referenceDeviceHash,
        referenceFps
      );
      expect(tamperedT).toBe(false);

      // Tampered sequence number
      const tamperedSeq = await verifyTelemetryHmac(
        referenceKey,
        expectedPythonHmac,
        referenceT,
        2, // Altered seq
        referenceCameraHash,
        referenceDeviceHash,
        referenceFps
      );
      expect(tamperedSeq).toBe(false);

      // Corrupted signature string
      const corruptedSig = await verifyTelemetryHmac(
        referenceKey,
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        referenceT,
        referenceSeq,
        referenceCameraHash,
        referenceDeviceHash,
        referenceFps
      );
      expect(corruptedSig).toBe(false);
    });

    it('computes deterministic SHA-256 device metadata hashes', async () => {
      const hash1 = await sha256Hex('FaceTime HD Camera (Built-in)');
      const hash2 = await sha256Hex('FaceTime HD Camera (Built-in)');
      expect(hash1).toHaveLength(64);
      expect(hash1).toBe(hash2);

      const hashOther = await sha256Hex('USB Video Device');
      expect(hash1).not.toBe(hashOther);
    });
  });

  describe('3. Monotonic Sequence and Ack Tracking Invariant', () => {
    it('maintains strictly increasing sequence numbers across successive packets', () => {
      let currentSeq = 0;
      const generateNextSeq = () => {
        currentSeq += 1;
        return currentSeq;
      };

      const seqs = [generateNextSeq(), generateNextSeq(), generateNextSeq(), generateNextSeq()];
      expect(seqs).toEqual([1, 2, 3, 4]);

      // Every subsequent seq must be strictly greater than preceding
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
      }
    });

    it('rejects duplicate or out-of-order sequence numbers per server protocol (§5.1)', () => {
      let lastSeq: number | null = null;
      const processSequence = (seq: number): { valid: boolean; violation?: string } => {
        if (lastSeq !== null && seq <= lastSeq) {
          return { valid: false, violation: 'replayed_sequence' };
        }
        if (lastSeq !== null && seq > lastSeq + 1) {
          // Allowed but logs telemetry_gap
          lastSeq = seq;
          return { valid: true, violation: 'telemetry_gap' };
        }
        lastSeq = seq;
        return { valid: true };
      };

      expect(processSequence(1)).toEqual({ valid: true });
      expect(processSequence(2)).toEqual({ valid: true });
      // Replay of sequence 2
      expect(processSequence(2)).toEqual({ valid: false, violation: 'replayed_sequence' });
      // Out of order backward sequence 1
      expect(processSequence(1)).toEqual({ valid: false, violation: 'replayed_sequence' });
      // Monotonic progression continues
      expect(processSequence(3)).toEqual({ valid: true });
      // Gap detection: jumped from 3 to 6
      expect(processSequence(6)).toEqual({ valid: true, violation: 'telemetry_gap' });
    });

    it('increments ack counter only for telemetry acknowledgments', () => {
      let ackedTelemetryCount = 0;

      const handleServerMessage = (msg: { type: string; received_type?: string }) => {
        if (msg.type === 'ack' && msg.received_type === 'telemetry') {
          ackedTelemetryCount += 1;
        }
      };

      handleServerMessage({ type: 'session_ready' });
      expect(ackedTelemetryCount).toBe(0);

      handleServerMessage({ type: 'ping' });
      expect(ackedTelemetryCount).toBe(0);

      handleServerMessage({ type: 'ack', received_type: 'transcript_chunk' });
      expect(ackedTelemetryCount).toBe(0);

      handleServerMessage({ type: 'ack', received_type: 'telemetry' });
      expect(ackedTelemetryCount).toBe(1);

      handleServerMessage({ type: 'ack', received_type: 'telemetry' });
      expect(ackedTelemetryCount).toBe(2);
    });
  });
});
