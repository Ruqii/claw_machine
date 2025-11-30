# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kawaii AR Claw Machine is an interactive browser-based game that uses hand tracking to control a virtual claw machine. Players use hand gestures (point, pinch, open palm) captured via webcam to move the claw and grab kawaii-styled plush toys.

**Tech Stack:**
- React 19.2 + TypeScript
- Vite (dev server & build tool)
- Matter.js (2D physics engine, loaded via CDN)
- MediaPipe Hand Landmarker (hand tracking, loaded dynamically via ESM import)
- Tailwind CSS (via CDN)

## Development Commands

```bash
# Install dependencies
npm install

# Run development server (port 3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

**Environment Setup:**
- Set `GEMINI_API_KEY` in `.env.local` (required for hand tracking AI service)
- The API key is exposed to the client via Vite's `process.env.GEMINI_API_KEY`

## Architecture Overview

### State Machine (GameState enum in types.ts)

The game operates as a finite state machine with these states:
- `IDLE` → `MOVING` → `DESCENDING` → `CLOSING` → `LIFTING` → `CARRYING` → `DROPPING` → back to `IDLE`

State transitions are managed in `GameCanvas.tsx:updateStateMachine()` (line 191-275).

### Core Services

**HandTrackerService (`services/handTracker.ts`)**
- Initializes MediaPipe Hand Landmarker from CDN (dynamic import)
- Processes video frames to detect hand landmarks
- Classifies gestures (POINT/PINCH/OPEN) based on finger positions and distances
- Implements smoothing buffers (4-frame) for position and gesture debouncing (5-frame history)
- Returns normalized hand coordinates (0-1) with X-axis mirrored for selfie camera

**PhysicsWorld (`services/physicsWorld.ts`)**
- Manages Matter.js engine and rigid bodies
- Creates game boundaries: ground (75% width), separator wall at 75% mark, left/right walls
- Spawns kawaii toys (bears, bunnies, cube cats) with composite bodies
- Physics tuning: high density (0.01), no restitution (0.0), high friction (0.9) for realistic weight
- `findToyAt()` uses radius-based proximity detection for claw grabbing

### Main Game Loop (GameCanvas.tsx:gameLoop)

Runs at ~60fps via `requestAnimationFrame`:
1. **Update Phase:**
   - Process hand tracking from video feed
   - Update Matter.js physics engine
   - Execute state machine logic
   - Update claw position, depth, and angle
   - Manage toy constraints when grabbed

2. **Render Phase:**
   - Clear canvas
   - Draw separator wall
   - Render claw back legs (behind toys)
   - Render toys with Matter.js physics positions
   - Render claw front leg and hub (overlays toys)
   - Render hand cursor with gesture-based colors

### Claw Mechanics

**Claw Position & Extension:**
- `clawPos` tracks X/Y hub position (follows hand with 15% interpolation)
- `clawDepth` (0-1) controls arm extension down to play area
- Dynamic max extension calculated based on screen height: `height - clawPos.y - 130`

**Grab Detection (`attemptGrab()`, line 288-316):**
- Strict 25px radius from claw tip center
- Creates Matter.js constraint between claw and toy
- Off-center grabs (>10px) marked as unstable with 3% per-frame slip chance during `LIFTING`

**Toy Dropping (`dropToy()`, line 318-342):**
- Checks if claw X position is beyond 75% width (exit zone)
- Successful drops increment score and remove toy after 800ms delay
- Accidental drops (slips) don't count toward score

### Component Structure

- `App.tsx`: Landing screen with instructions, state management for game start
- `components/GameCanvas.tsx`: Main game component with canvas rendering, state machine, refs for services

### Path Alias

TypeScript and Vite both use `@/*` to resolve to project root (configured in `tsconfig.json` and `vite.config.ts`).

## Key Implementation Details

**Hand Tracking Initialization:**
- MediaPipe loads asynchronously after camera setup
- Game loop starts immediately to show physics, hand tracking enables when ready
- `isReady` state tracks AI model load completion

**Video Feed:**
- Mirrored via `scale-x-[-1]` CSS transform for natural selfie interaction
- Opacity reduced to 60% to blend with game graphics
- Requires `getUserMedia` camera permission

**Gesture Recognition Thresholds:**
- PINCH: thumb-index distance < 0.08
- OPEN: palm open (fingers extended) AND pinch distance > 0.12
- POINT: default state when neither PINCH nor OPEN conditions met

**Responsive Handling:**
- Canvas resizes to container dimensions on every frame
- Physics world updates wall positions via `resize()`
- Claw re-centers if off-screen after resize

## External Dependencies (CDN)

All major libraries are loaded via CDN (no bundling):
- Matter.js: `https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js`
- MediaPipe: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/+esm`
- Tailwind CSS: `https://cdn.tailwindcss.com`
- React/React-DOM: Via importmap from `aistudiocdn.com`

This means builds are lightweight but require internet connectivity.
