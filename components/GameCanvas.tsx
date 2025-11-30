import React, { useEffect, useRef, useState } from 'react';
import { GameState, GestureType, HandInput } from '../types';
import { HandTrackerService } from '../services/handTracker';
import { PhysicsWorld } from '../services/physicsWorld';

declare const Matter: any;

export const GameCanvas: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Game Logic Refs
  const handTracker = useRef(new HandTrackerService({ apiKey: process.env.API_KEY }));
  const physics = useRef(new PhysicsWorld({}));
  const requestRef = useRef<number>(0);
  
  // State Machine Refs
  const state = useRef<GameState>(GameState.COUNTDOWN);
  const clawPos = useRef({ x: 0, y: 100 });
  const clawTargetPos = useRef({ x: 0, y: 100 });
  const clawDepth = useRef(0);
  const clawAngle = useRef(0); // 0 = Open, 1 = Closed
  const attachedToy = useRef<any>(null);
  const toyConstraint = useRef<any>(null);
  const resultTimer = useRef(0);
  const countdownTimer = useRef(180); // 3 seconds at 60fps
  const isGripUnstable = useRef(false);

  // Pinch gesture debouncing
  const pinchHistory = useRef<boolean[]>([]);
  const PINCH_FRAMES_REQUIRED = 8; // Require 8 consecutive frames of pinch

  // UI State
  const [uiState, setUiState] = useState(GameState.COUNTDOWN);
  const [debugGesture, setDebugGesture] = useState<string>('Initializing AI...');
  const [score, setScore] = useState(0);
  const [credits, setCredits] = useState(3);
  const [grabResult, setGrabResult] = useState<'success' | 'fail' | null>(null);
  const [countdownValue, setCountdownValue] = useState(3);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let active = true;

    const init = async () => {
      if (containerRef.current) {
        // Init Physics immediately so we see walls/toys
        physics.current.init(containerRef.current.clientWidth, containerRef.current.clientHeight);
        physics.current.spawnToys(40);
        
        // Set initial claw pos
        clawPos.current = { x: containerRef.current.clientWidth / 2, y: 100 };
      }

      // Start Loop Immediately
      requestRef.current = requestAnimationFrame(gameLoop);

      // Setup Camera
      if (navigator.mediaDevices && videoRef.current) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: 'user'
            }
          });
          if (active && videoRef.current) {
            videoRef.current.srcObject = stream;
            await new Promise((resolve) => {
              if (videoRef.current) {
                videoRef.current.onloadedmetadata = () => {
                  videoRef.current?.play();
                  resolve(true);
                };
              }
            });
          }
        } catch (e) {
          console.error("Camera failed", e);
          setDebugGesture("Camera Error - Check Permissions");
        }
      }

      // Init AI (Async)
      console.log("Loading Hand Tracker...");
      try {
        await handTracker.current.initialize();
        console.log("Hand Tracker Ready");
        if (active) setIsReady(true);
      } catch (err) {
        console.error("Failed to load Hand Tracker", err);
        setDebugGesture("AI Load Failed");
      }
    };

    init();

    return () => {
      active = false;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  const gameLoop = (time: number) => {
    if (!canvasRef.current || !containerRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    // Resize handling
    if (canvasRef.current.width !== width || canvasRef.current.height !== height) {
      canvasRef.current.width = width;
      canvasRef.current.height = height;
      physics.current.resize(width, height);
      // Re-center claw if it's way off
      if (clawPos.current.x > width) clawPos.current.x = width / 2;
    }

    // --- 1. UPDATE ---
    Matter.Engine.update(physics.current.engine, 1000 / 60);

    // Hand Tracking
    let hand: HandInput = { x: 0.5, y: 0.5, gesture: GestureType.NONE, isPresent: false };
    
    // Only process if video is actually ready and playing
    if (videoRef.current && videoRef.current.readyState >= 2 && videoRef.current.videoWidth > 0) {
      hand = handTracker.current.process(videoRef.current, performance.now());
    }
    
    // UI Updates
    if (hand.isPresent) {
      setDebugGesture(`${hand.gesture}`);
    } else if (!isReady) {
      // Keep existing message
    } else {
      setDebugGesture('Show Hand');
    }

    // STATE MACHINE
    updateStateMachine(hand, width, height);

    if (state.current !== uiState) setUiState(state.current);

    // --- 2. RENDER ---
    ctx.clearRect(0, 0, width, height);
    
    // Draw Separator Wall Visual
    const pitWidth = width * 0.75;
    ctx.fillStyle = '#fbcfe8'; // Pink barrier
    ctx.beginPath();
    // Match PhysicsWorld separator dimensions
    ctx.roundRect(pitWidth - 10, height - 30 - 220, 20, 220, 10);
    ctx.fill();
    ctx.strokeStyle = '#f472b6';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Calculate dynamic extension based on height
    const maxExtension = height - clawPos.current.y - 130; 
    const currentExtension = clawDepth.current * maxExtension;

    // Layer 1: Back Claw (Behind Toys)
    renderClawBack(ctx, currentExtension);

    // Layer 2: Toys
    renderToys(ctx);

    // Layer 3: Front Claw (Overlays Toys)
    renderClawFront(ctx, currentExtension);

    // Render Hand Cursor
    if (hand.isPresent) {
      const cursorX = hand.x * width;
      const cursorY = hand.y * height;
      
      // Outer glow
      ctx.shadowBlur = 15;
      ctx.shadowColor = getCursorColor(hand.gesture);
      
      ctx.beginPath();
      ctx.arc(cursorX, cursorY, 15, 0, Math.PI * 2);
      ctx.fillStyle = getCursorColor(hand.gesture);
      ctx.fill();
      
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 3;
      ctx.stroke();
      
      ctx.shadowBlur = 0;
    }

    requestRef.current = requestAnimationFrame(gameLoop);
  };

  const updateStateMachine = (hand: HandInput, width: number, height: number) => {
    const s = state.current;

    // Calculate max extension for logic usage
    const maxExtension = height - clawPos.current.y - 130;

    // EXIT zone threshold (right 25% of screen)
    const exitZoneX = width * 0.75;

    // Helper: Check if pinch is stable (detected for required frames)
    const isPinchStable = () => {
      const isPinching = hand.isPresent && hand.gesture === GestureType.PINCH;
      pinchHistory.current.push(isPinching);
      if (pinchHistory.current.length > PINCH_FRAMES_REQUIRED) {
        pinchHistory.current.shift();
      }
      return pinchHistory.current.length === PINCH_FRAMES_REQUIRED &&
             pinchHistory.current.every(p => p === true);
    };

    // COUNTDOWN STATE - Ignore all gestures, count down
    if (s === GameState.COUNTDOWN) {
      countdownTimer.current--;

      // Update countdown display every 60 frames (1 second)
      if (countdownTimer.current % 60 === 0) {
        const secondsLeft = Math.ceil(countdownTimer.current / 60);
        setCountdownValue(secondsLeft);
      }

      if (countdownTimer.current <= 0) {
        state.current = GameState.READY;
        setCountdownValue(0);
      }
      return;
    }

    // READY STATE - Allow hand movement and detect stable PINCH to start grab
    if (s === GameState.READY) {
      // Allow claw movement with hand
      if (hand.isPresent && hand.gesture !== GestureType.NONE) {
        const targetX = hand.x * width;
        const targetY = hand.y * height * 0.8;

        clawPos.current.x += (targetX - clawPos.current.x) * 0.15;
        // Keep claw hub in upper area
        const maxY = height / 3;
        const clampedTargetY = Math.min(targetY, maxY);
        clawPos.current.y += (clampedTargetY - clawPos.current.y) * 0.15;
      }

      // Check for STABLE PINCH to start grab sequence
      if (isPinchStable() && credits > 0) {
        // Deduct credit and start grab sequence
        setCredits(c => c - 1);
        state.current = GameState.DESCENDING;
        // Clear pinch history
        pinchHistory.current = [];
      } else if (!hand.isPresent || hand.gesture !== GestureType.PINCH) {
        // Reset pinch history if not pinching
        pinchHistory.current = [];
      }
      return;
    }

    // AUTOMATED GRAB SEQUENCE - Ignore all gestures
    switch (s) {
      case GameState.DESCENDING:
        // Slow, realistic descent (~1.4 seconds at 60fps)
        clawDepth.current += 0.012;
        if (clawDepth.current >= 1) {
          clawDepth.current = 1;
          state.current = GameState.CLOSING;
        }
        break;

      case GameState.CLOSING:
        // Slow, deliberate closing (~0.67 seconds at 60fps)
        clawAngle.current += 0.025;
        if (clawAngle.current >= 1) {
          clawAngle.current = 1;
          attemptGrab(maxExtension);
          state.current = GameState.LIFTING;
        }
        break;

      case GameState.LIFTING:
        // Slow lift matching descent speed
        clawDepth.current -= 0.012;

        // SLIP LOGIC: If grip is unstable, random chance to drop
        if (attachedToy.current && isGripUnstable.current) {
          if (Math.random() < 0.03) {
            // Toy slipped - remove constraint
            if (toyConstraint.current) {
              Matter.World.remove(physics.current.engine.world, toyConstraint.current);
              toyConstraint.current = null;
            }
            attachedToy.current = null;
            isGripUnstable.current = false;
          }
        }

        if (clawDepth.current <= 0) {
          clawDepth.current = 0;
          // Move to CARRYING state (allow user to move and drop)
          state.current = GameState.CARRYING;
        }
        updateConstraint(maxExtension);
        break;

      case GameState.CARRYING:
        // Allow claw movement with hand
        if (hand.isPresent && hand.gesture !== GestureType.NONE) {
          const targetX = hand.x * width;
          const targetY = hand.y * height * 0.8;

          clawPos.current.x += (targetX - clawPos.current.x) * 0.15;
          const maxY = height / 3;
          const clampedTargetY = Math.min(targetY, maxY);
          clawPos.current.y += (clampedTargetY - clawPos.current.y) * 0.15;
        }

        updateConstraint(maxExtension);

        // Check for OPEN gesture to drop
        if (hand.isPresent && hand.gesture === GestureType.OPEN) {
          state.current = GameState.DROPPING;
        }
        break;

      case GameState.DROPPING:
        // Open claw slowly
        if (clawAngle.current > 0) {
          clawAngle.current -= 0.025;
          if (clawAngle.current < 0) clawAngle.current = 0;
        }

        // Release constraint
        if (toyConstraint.current) {
          Matter.World.remove(physics.current.engine.world, toyConstraint.current);
          toyConstraint.current = null;
        }

        // Check if we dropped in EXIT zone
        const isInExitZone = clawPos.current.x >= exitZoneX;
        const hadToy = !!attachedToy.current;

        if (hadToy && attachedToy.current) {
          if (isInExitZone) {
            // SUCCESS! Dropped in exit zone
            setScore(s => s + 1);
            // Remove toy after brief delay to show it falling
            const winningToy = attachedToy.current;
            setTimeout(() => {
              physics.current.removeBody(winningToy);
            }, 500);
            setGrabResult('success');
          } else {
            // FAIL - dropped back in pit
            setGrabResult('fail');
          }
        } else {
          // FAIL - no toy was grabbed
          setGrabResult('fail');
        }

        attachedToy.current = null;
        isGripUnstable.current = false;

        // Move to result display
        state.current = GameState.SHOWING_RESULT;
        resultTimer.current = 90; // ~1.5 seconds at 60fps
        break;

      case GameState.SHOWING_RESULT:
        resultTimer.current--;

        if (resultTimer.current <= 0) {
          // Return to READY state
          setGrabResult(null);
          state.current = GameState.READY;
        }
        break;
    }
  };

  const updateConstraint = (maxExtension: number) => {
    if (attachedToy.current && toyConstraint.current) {
        const depth = clawDepth.current; 
        const extension = depth * maxExtension;
        const y = clawPos.current.y + extension; 
        
        // Update anchor to follow claw tip
        toyConstraint.current.pointA = { x: clawPos.current.x, y: y + 40 }; 
    }
  };

  const attemptGrab = (maxExtension: number) => {
    // Claw tip position (visual)
    const depth = clawDepth.current; 
    const extension = depth * maxExtension;
    const x = clawPos.current.x;
    const y = clawPos.current.y + extension + 80; // Approximate grip center

    // DIFFICULTY UPDATE: Strict Radius (25px)
    const toy = physics.current.findToyAt(x, y, 25);
    
    if (toy) {
      attachedToy.current = toy;
      
      // Calculate offset for "Slippery" logic
      const dist = Math.hypot(toy.position.x - x, toy.position.y - y);
      isGripUnstable.current = dist > 10; // If > 10px off-center, it's unstable

      toyConstraint.current = Matter.Constraint.create({
        pointA: { x: x, y: y },
        bodyB: toy,
        stiffness: 0.8, // Stronger to lift heavy weight
        length: 10, 
        render: { visible: false }
      });
      Matter.World.add(physics.current.engine.world, toyConstraint.current);
    } else {
        isGripUnstable.current = false;
    }
  };


  // --- RENDERING HELPERS ---

  const renderToys = (ctx: CanvasRenderingContext2D) => {
    const bodies = Matter.Composite.allBodies(physics.current.engine.world);
    
    bodies.forEach((body: any) => {
      // Only render Toys (ignore static walls)
      if (body.label !== 'Toy') return;

      const partsToDraw = body.parts.length > 1 ? body.parts.slice(1) : body.parts;

      partsToDraw.forEach((part: any) => {
        ctx.beginPath();
        const vertices = part.vertices;
        ctx.moveTo(vertices[0].x, vertices[0].y);
        for (let j = 1; j < vertices.length; j += 1) {
            ctx.lineTo(vertices[j].x, vertices[j].y);
        }
        ctx.lineTo(vertices[0].x, vertices[0].y);
        
        ctx.fillStyle = body.render.fillStyle; 
        ctx.strokeStyle = body.render.strokeStyle;
        ctx.lineWidth = body.render.lineWidth;
        ctx.fill();
        ctx.stroke();
      });

      // Simple Face (Only on Head)
      const head = partsToDraw[0];
      if (head) {
        ctx.save();
        ctx.translate(head.position.x, head.position.y);
        ctx.rotate(head.angle);
        ctx.fillStyle = '#333';
        // Eyes
        ctx.beginPath();
        ctx.arc(-10, -5, 3, 0, Math.PI * 2);
        ctx.arc(10, -5, 3, 0, Math.PI * 2);
        ctx.fill();
        // Mouth
        ctx.beginPath();
        ctx.arc(0, 3, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });
  };

  const renderClawBack = (ctx: CanvasRenderingContext2D, extension: number) => {
    const x = clawPos.current.x;
    const y = clawPos.current.y;
    const angle = clawAngle.current; // 0..1

    const currentY = y + extension;

    // Draw Wire
    ctx.beginPath();
    ctx.moveTo(x, -100); 
    
    // ZigZag Wire
    const segs = 10 + Math.floor(extension / 20);
    const amp = 5;
    for(let i=0; i<segs; i++) {
        const segY = -50 + (i * (currentY + 50) / segs);
        ctx.lineTo(x + (i % 2 === 0 ? amp : -amp), segY);
    }
    ctx.lineTo(x, currentY);
    
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#475569';
    ctx.stroke();

    ctx.save();
    ctx.translate(x, currentY);

    // --- LEFT LEG (Back) ---
    const leftElbowX = -50 + (angle * 20); 
    const leftElbowY = 50;
    const leftTipX = -60 + (angle * 40);   
    const leftTipY = 90;

    drawLeg(ctx, -20, 0, leftElbowX, leftElbowY, leftTipX, leftTipY, '#64748b');

    // --- RIGHT LEG (Back) ---
    const rightElbowX = 50 - (angle * 20);
    const rightElbowY = 50;
    const rightTipX = 60 - (angle * 40);
    const rightTipY = 90;

    drawLeg(ctx, 20, 0, rightElbowX, rightElbowY, rightTipX, rightTipY, '#64748b');

    ctx.restore();
  };

  const renderClawFront = (ctx: CanvasRenderingContext2D, extension: number) => {
    const x = clawPos.current.x;
    const y = clawPos.current.y;
    const angle = clawAngle.current;

    const currentY = y + extension;

    ctx.save();
    ctx.translate(x, currentY);

    // --- FRONT LEG ---
    const frontElbowX = 0;
    const frontElbowY = 40; 
    const frontTipX = 0;
    const frontTipY = 80 - (angle * 10); 

    drawLeg(ctx, 0, 5, frontElbowX, frontElbowY, frontTipX, frontTipY, '#94a3b8');

    // --- HUB (Motor Box) ---
    ctx.fillStyle = '#6366f1'; 
    ctx.beginPath();
    ctx.roundRect(-25, -20, 50, 40, 8);
    ctx.fill();
    
    ctx.fillStyle = '#818cf8';
    ctx.beginPath();
    ctx.roundRect(-20, -15, 40, 10, 4);
    ctx.fill();
    
    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(-15, 20);
    ctx.lineTo(15, 20);
    ctx.lineTo(10, 30);
    ctx.lineTo(-10, 30);
    ctx.fill();

    ctx.restore();
  };

  const drawLeg = (
      ctx: CanvasRenderingContext2D, 
      sx: number, sy: number, 
      ex: number, ey: number, 
      tx: number, ty: number, 
      color: string
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.arc(sx, sy, 6, 0, Math.PI*2);
      ctx.fill();
      
      ctx.beginPath();
      ctx.arc(ex, ey, 5, 0, Math.PI*2);
      ctx.fill();
  };

  const getCursorColor = (g: GestureType) => {
    switch (g) {
      case GestureType.POINT: return '#60a5fa'; 
      case GestureType.PINCH: return '#f472b6'; 
      case GestureType.OPEN: return '#4ade80'; 
      default: return 'white';
    }
  };

  return (
    <div ref={containerRef} className="relative w-full h-full bg-pink-50 overflow-hidden">
      {/* 1. Camera Feed (Mirrored) */}
      <video 
        ref={videoRef} 
        className="absolute top-0 left-0 w-full h-full object-cover opacity-60 pointer-events-none scale-x-[-1]" 
        muted 
        playsInline 
      />
      
      {/* 2. Main Game Canvas */}
      <canvas ref={canvasRef} className="absolute top-0 left-0 z-10 block" />

      {/* 3. UI Overlay */}
      <div className="absolute inset-0 z-20 pointer-events-none border-[24px] border-pink-200 rounded-3xl shadow-[inset_0_0_80px_rgba(0,0,0,0.1)]">
        
        {/* TOP LEFT: Score, Credits & Title */}
        <div className="absolute top-6 left-6 flex flex-col items-start gap-2">
           <div className="bg-white/90 px-6 py-2 rounded-full border-4 border-pink-400 shadow-xl">
              <h1 className="text-xl font-black text-pink-500 tracking-wider">KAWAII CLAW</h1>
           </div>

           <div className="bg-yellow-300 px-5 py-3 rounded-2xl border-b-8 border-r-8 border-yellow-500 shadow-lg transform -rotate-2">
              <span className="text-[10px] font-black text-yellow-700 uppercase tracking-widest block">Collected</span>
              <div className="text-3xl font-black text-white drop-shadow-md">{score}</div>
           </div>

           {/* Credits Counter */}
           <div className="bg-blue-400 px-5 py-3 rounded-2xl border-b-8 border-r-8 border-blue-600 shadow-lg transform rotate-1">
              <span className="text-[10px] font-black text-blue-800 uppercase tracking-widest block">Credits</span>
              <div className="text-3xl font-black text-white drop-shadow-md">{credits}</div>
           </div>

           {/* Debug Text */}
           <div className="text-[10px] font-mono text-gray-400 bg-white/50 px-2 rounded mt-2">
              {debugGesture}
           </div>
        </div>

        {/* TOP RIGHT: Gesture Instructions (Status) */}
        <div className="absolute top-6 right-6">
           <div className={`px-6 py-4 rounded-2xl text-white font-bold text-xl shadow-xl transition-all duration-300 border-b-8 border-r-8 transform rotate-1
             ${uiState === GameState.COUNTDOWN ? 'bg-yellow-400 border-yellow-600' :
               uiState === GameState.READY ? 'bg-blue-400 border-blue-600' :
               (uiState === GameState.DESCENDING || uiState === GameState.CLOSING || uiState === GameState.LIFTING) ? 'bg-purple-400 border-purple-600' :
               uiState === GameState.CARRYING ? 'bg-green-400 border-green-600' : 'bg-gray-400 border-gray-600'}`}>

              {uiState === GameState.COUNTDOWN && (
                 <span className="flex items-center gap-2"><span className="text-2xl">⏰</span> Get Ready!</span>
              )}
              {uiState === GameState.READY && credits > 0 && (
                 <span className="flex items-center gap-2"><span className="text-2xl">👌</span> Pinch to Grab</span>
              )}
              {uiState === GameState.READY && credits === 0 && (
                 <span className="flex items-center gap-2"><span className="text-2xl">💰</span> Need Credits!</span>
              )}
              {(uiState === GameState.DESCENDING || uiState === GameState.CLOSING || uiState === GameState.LIFTING) && (
                 <span className="animate-pulse">Grabbing...</span>
              )}
              {uiState === GameState.CARRYING && (
                 <span className="flex items-center gap-2"><span className="text-2xl">✋</span> Move to EXIT & Open</span>
              )}
              {uiState === GameState.DROPPING && (
                 <span className="animate-pulse">Dropping...</span>
              )}
              {uiState === GameState.SHOWING_RESULT && grabResult === 'success' && (
                 <span className="flex items-center gap-2"><span className="text-2xl">🎉</span> You Won!</span>
              )}
              {uiState === GameState.SHOWING_RESULT && grabResult === 'fail' && (
                 <span className="flex items-center gap-2"><span className="text-2xl">😢</span> Try Again!</span>
              )}
           </div>
        </div>

        {/* CENTER: Countdown Display */}
        {uiState === GameState.COUNTDOWN && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <div className="text-center">
              {countdownValue > 0 ? (
                <div className="text-[200px] font-black text-white drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)] animate-bounce">
                  {countdownValue}
                </div>
              ) : (
                <div className="text-[120px] font-black text-green-400 drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)] animate-pulse">
                  GO!
                </div>
              )}
            </div>
          </div>
        )}

        {/* CENTER: No Credits Message & Purchase Button */}
        {credits === 0 && uiState === GameState.READY && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
            <div className="bg-white/95 p-8 rounded-3xl shadow-2xl border-b-8 border-pink-400 max-w-sm">
              <div className="text-5xl mb-4 text-center">💰</div>
              <h2 className="text-2xl font-black text-pink-500 mb-3 text-center">Out of Credits!</h2>
              <p className="text-gray-600 mb-6 text-center">Purchase more credits to keep playing</p>
              <button
                onClick={() => setCredits(3)}
                className="w-full bg-pink-500 hover:bg-pink-600 text-white font-bold text-xl py-4 rounded-xl shadow-lg active:scale-95 transition-transform"
              >
                Add 3 Credits
              </button>
            </div>
          </div>
        )}

        {/* CENTER: Result Display */}
        {uiState === GameState.SHOWING_RESULT && grabResult && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <div className={`p-12 rounded-3xl shadow-2xl border-b-8 transform scale-110 ${
              grabResult === 'success' ? 'bg-green-400 border-green-600' : 'bg-orange-400 border-orange-600'
            }`}>
              <div className="text-8xl mb-4 text-center animate-bounce">
                {grabResult === 'success' ? '🎉' : '😢'}
              </div>
              <h2 className="text-4xl font-black text-white drop-shadow-lg text-center">
                {grabResult === 'success' ? 'SUCCESS!' : 'OH NO!'}
              </h2>
              {grabResult === 'success' && (
                <p className="text-white text-xl mt-2 text-center font-bold">You caught a kawaii friend!</p>
              )}
              {grabResult === 'fail' && (
                <p className="text-white text-xl mt-2 text-center font-bold">Better luck next time!</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};