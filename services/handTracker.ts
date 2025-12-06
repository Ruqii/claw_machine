import { GestureType, HandInput } from '../types';

// We use dynamic imports for these types to avoid build-time errors, 
// but we declare them here for TypeScript intellisense if available.
type HandLandmarkerType = any;
type FilesetResolverType = any;

export class HandTrackerService {
  private handLandmarker: HandLandmarkerType | null = null;
  private lastResult: HandInput = { x: 0.5, y: 0.5, gesture: GestureType.NONE, isPresent: false };
  
  // Smoothing buffers
  private xBuffer: number[] = [];
  private yBuffer: number[] = [];
  private readonly BUFFER_SIZE = 4; // Slightly faster response
  
  // Gesture Debounce
  private gestureHistory: GestureType[] = [];
  private readonly HISTORY_SIZE = 5;

  async initialize() {
    // Dynamic import from CDN to ensure correct ESM loading
    // @ts-ignore
    const { FilesetResolver, HandLandmarker } = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/+esm");

    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    
    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
  }

  process(video: HTMLVideoElement, timestamp: number): HandInput {
    // Safety check: Video must have dimensions
    if (!this.handLandmarker || !video.videoWidth || !video.videoHeight) {
      return this.lastResult;
    }

    let results;
    try {
      results = this.handLandmarker.detectForVideo(video, timestamp);
    } catch (e) {
      console.warn("MediaPipe detection error:", e);
      return this.lastResult;
    }

    if (results.landmarks && results.landmarks.length > 0) {
      const landmarks = results.landmarks[0];
      
      // Index finger tip (8) and Thumb tip (4)
      const indexTip = landmarks[8];
      const thumbTip = landmarks[4];
      const middleTip = landmarks[12];
      const ringTip = landmarks[16];
      const pinkyTip = landmarks[20];
      const wrist = landmarks[0];

      // 1. Calculate Position (Index tip is the cursor)
      // Mirror X because it's a selfie camera
      const rawX = 1.0 - indexTip.x; 
      const rawY = indexTip.y;

      const smoothedX = this.smooth(this.xBuffer, rawX);
      const smoothedY = this.smooth(this.yBuffer, rawY);

      // 2. Detect Gesture
      // Calculate pinch distance
      const pinchDist = Math.hypot(indexTip.x - thumbTip.x, indexTip.y - thumbTip.y);
      
      // Check if other fingers are extended (roughly)
      // If finger tips are above wrist (y is smaller is higher), they are extended "up"
      // But simpler check: distance from wrist
      const isPalmOpen = (
        this.dist(middleTip, wrist) > 0.1 && 
        this.dist(ringTip, wrist) > 0.1 && 
        this.dist(pinkyTip, wrist) > 0.1
      );
      
      let rawGesture = GestureType.POINT;

      // Pinch threshold - strict to prevent false positives
      if (pinchDist < 0.05) {
        rawGesture = GestureType.PINCH;
      } 
      // Open hand: Fingers extended and pinch is NOT active
      else if (isPalmOpen && pinchDist > 0.12) {
        rawGesture = GestureType.OPEN;
      }

      const stableGesture = this.getStableGesture(rawGesture);

      this.lastResult = {
        x: smoothedX,
        y: smoothedY,
        gesture: stableGesture,
        isPresent: true
      };
    } else {
      // Decay presence
      this.lastResult = { ...this.lastResult, isPresent: false };
    }

    return this.lastResult;
  }

  private dist(a: any, b: any) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private smooth(buffer: number[], value: number): number {
    buffer.push(value);
    if (buffer.length > this.BUFFER_SIZE) buffer.shift();
    return buffer.reduce((a, b) => a + b, 0) / buffer.length;
  }

  private getStableGesture(current: GestureType): GestureType {
    this.gestureHistory.push(current);
    if (this.gestureHistory.length > this.HISTORY_SIZE) this.gestureHistory.shift();

    // Frequency map
    const counts: Record<string, number> = {};
    for (const g of this.gestureHistory) {
      counts[g] = (counts[g] || 0) + 1;
    }

    const threshold = Math.ceil(this.HISTORY_SIZE * 0.85); // Require 85% consistency

    // Priority: PINCH > OPEN > POINT
    if ((counts[GestureType.PINCH] || 0) >= threshold) return GestureType.PINCH;
    if ((counts[GestureType.OPEN] || 0) >= threshold) return GestureType.OPEN;
    if ((counts[GestureType.POINT] || 0) >= threshold) return GestureType.POINT;

    return this.gestureHistory[this.gestureHistory.length - 1]; // Fallback
  }
}