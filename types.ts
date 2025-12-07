export enum GameState {
  WAITING_FOR_TOYS = 'WAITING_FOR_TOYS', // Waiting for toys to settle after spawn
  COUNTDOWN = 'COUNTDOWN',   // Initial countdown (3, 2, 1, GO) - ignore all gestures
  READY = 'READY',           // Waiting for stable pinch (user can move claw)
  DESCENDING = 'DESCENDING', // Claw dropping (automated - no gestures)
  CLOSING = 'CLOSING',       // Prongs closing (automated)
  LIFTING = 'LIFTING',       // Claw going back up (automated)
  CARRYING = 'CARRYING',     // User can move claw to EXIT and open to drop
  DROPPING = 'DROPPING',     // Releasing toy (check if over EXIT)
}

export enum GestureType {
  NONE = 'NONE',
  POINT = 'POINT',
  PINCH = 'PINCH',
  OPEN = 'OPEN',
}

export interface HandInput {
  x: number; // Normalized 0-1
  y: number; // Normalized 0-1
  gesture: GestureType;
  isPresent: boolean;
}

export interface ClawConfig {
  x: number;
  y: number;
  width: number;
  isOpen: boolean;
  angle: number; // For prong animation
}
