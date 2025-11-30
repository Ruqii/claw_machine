export enum GameState {
  IDLE = 'IDLE',           // Waiting for hand
  MOVING = 'MOVING',       // User moving claw with POINT
  DESCENDING = 'DESCENDING', // Claw dropping (Animation)
  CLOSING = 'CLOSING',     // Prongs closing
  LIFTING = 'LIFTING',     // Claw going back up
  CARRYING = 'CARRYING',   // Moving with potential prize
  DROPPING = 'DROPPING',   // Releasing toy
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
