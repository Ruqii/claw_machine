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
  const state = useRef<GameState>(GameState.IDLE);
  const clawPos = useRef({ x: 0, y: 100 }); 
  const clawDepth = useRef(0);
  const clawAngle = useRef(0); // 0 = Open, 1 = Closed
  const attachedToy = useRef<any>(null);
  const toyConstraint = useRef<any>(null);
  const dropTimer = useRef(0);
  const isGripUnstable = useRef(false);

  // UI State
  const [uiState, setUiState] = useState(GameState.IDLE);
  const [debugGesture, setDebugGesture] = useState<string>('Initializing AI...');
  const [score, setScore] = useState(0);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let active = true;

    const init = async () => {
      if (containerRef.current) {
        // Init Physics immediately so we see walls/toys
        physics.current.init(containerRef.current.clientWidth, containerRef.current.clientHeight);
        physics.current.spawnToys(12);
        
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
    
    // MOVEMENT - Only move X/Y when POINTING or IDLE (and not carrying)
    if (s === GameState.MOVING || s === GameState.IDLE || s === GameState.CARRYING) {
      if (hand.isPresent && hand.gesture !== GestureType.NONE) {
        if (s === GameState.IDLE) state.current = GameState.MOVING;

        const targetX = hand.x * width;
        const targetY = hand.y * height * 0.8; 
        
        clawPos.current.x += (targetX - clawPos.current.x) * 0.15;
        // Keep claw hub in upper area, don't let it go too low
        const maxY = height / 3;
        const clampedTargetY = Math.min(targetY, maxY);
        clawPos.current.y += (clampedTargetY - clawPos.current.y) * 0.15;
      }
    }

    // TRANSITIONS
    switch (s) {
      case GameState.MOVING:
        if (hand.isPresent && hand.gesture === GestureType.PINCH) {
          state.current = GameState.DESCENDING;
        }
        break;

      case GameState.DESCENDING:
        clawDepth.current += 0.04; // Faster drop
        if (clawDepth.current >= 1) {
          clawDepth.current = 1;
          state.current = GameState.CLOSING;
        }
        break;

      case GameState.CLOSING:
        clawAngle.current += 0.08;
        if (clawAngle.current >= 1) {
          clawAngle.current = 1;
          attemptGrab(maxExtension);
          state.current = GameState.LIFTING;
        }
        break;

      case GameState.LIFTING:
        clawDepth.current -= 0.04;
        
        // SLIP LOGIC: If grip is unstable, random chance to drop
        if (attachedToy.current && isGripUnstable.current) {
            if (Math.random() < 0.03) { // 3% chance per frame to slip
                dropToy(width, true); // True = accidental drop
            }
        }

        if (clawDepth.current <= 0) {
          clawDepth.current = 0;
          state.current = GameState.CARRYING;
        }
        updateConstraint(maxExtension);
        break;

      case GameState.CARRYING:
        updateConstraint(maxExtension);

        // Release
        if (hand.isPresent && hand.gesture === GestureType.OPEN) {
          dropToy(width, false);
        }
        break;

      case GameState.DROPPING:
        dropTimer.current--;
        if (dropTimer.current <= 0) {
          clawAngle.current -= 0.05;
          if (clawAngle.current <= 0) {
            clawAngle.current = 0;
            state.current = GameState.IDLE;
          }
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

  const dropToy = (screenWidth: number, isAccidental: boolean) => {
    const isOverExit = clawPos.current.x > screenWidth * 0.75;
    
    if (toyConstraint.current) {
      Matter.World.remove(physics.current.engine.world, toyConstraint.current);
      toyConstraint.current = null;
      
      if (!isAccidental && isOverExit && attachedToy.current) {
        // Winning Drop!
        setScore(s => s + 1);
        
        // Keep a reference to the toy to remove it after a delay
        const winningToy = attachedToy.current;
        setTimeout(() => {
          physics.current.removeBody(winningToy);
        }, 800); // Let it fall for 0.8s then disappear
      }
      
      attachedToy.current = null;
    }
    
    // Animation wait time
    dropTimer.current = 20; 
    state.current = GameState.DROPPING;
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
        
        {/* TOP LEFT: Score & Title */}
        <div className="absolute top-6 left-6 flex flex-col items-start gap-2">
           <div className="bg-white/90 px-6 py-2 rounded-full border-4 border-pink-400 shadow-xl">
              <h1 className="text-xl font-black text-pink-500 tracking-wider">KAWAII CLAW</h1>
           </div>
           
           <div className="bg-yellow-300 px-5 py-3 rounded-2xl border-b-8 border-r-8 border-yellow-500 shadow-lg transform -rotate-2">
              <span className="text-[10px] font-black text-yellow-700 uppercase tracking-widest block">Collected</span>
              <div className="text-3xl font-black text-white drop-shadow-md">{score}</div>
           </div>
           
           {/* Debug Text */}
           <div className="text-[10px] font-mono text-gray-400 bg-white/50 px-2 rounded mt-2">
              {debugGesture}
           </div>
        </div>

        {/* TOP RIGHT: Gesture Instructions (Status) */}
        <div className="absolute top-6 right-6">
           <div className={`px-6 py-4 rounded-2xl text-white font-bold text-xl shadow-xl transition-all duration-300 border-b-8 border-r-8 transform rotate-1
             ${uiState === GameState.MOVING ? 'bg-blue-400 border-blue-600' : 
               uiState === GameState.DESCENDING ? 'bg-purple-400 border-purple-600' :
               uiState === GameState.CARRYING ? 'bg-green-400 border-green-600' : 'bg-gray-400 border-gray-600'}`}>
              
              {uiState === GameState.IDLE && (
                 <span className="flex items-center gap-2"><span className="text-2xl">☝️</span> Point to Move</span>
              )}
              {uiState === GameState.MOVING && (
                 <span className="flex items-center gap-2"><span className="text-2xl">👌</span> Pinch to Grab</span>
              )}
              {(uiState === GameState.DESCENDING || uiState === GameState.CLOSING || uiState === GameState.LIFTING) && (
                 <span className="animate-pulse">Grabbing...</span>
              )}
              {uiState === GameState.CARRYING && (
                 <span className="flex items-center gap-2"><span className="text-2xl">✋</span> Open to Drop</span>
              )}
              {uiState === GameState.DROPPING && "Yay! Dropping!"}
           </div>
        </div>

        {/* Exit Zone Indicator */}
        <div className="absolute bottom-0 right-0 w-[25%] h-[200px] bg-gradient-to-t from-black/10 to-transparent border-l-4 border-dashed border-white/40 flex items-end justify-center pb-8">
           <span className="text-white font-black text-2xl tracking-widest opacity-80 animate-bounce">EXIT</span>
        </div>
      </div>
    </div>
  );
};