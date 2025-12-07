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
  const handTracker = useRef(new HandTrackerService());
  const physics = useRef(new PhysicsWorld({}));
  const requestRef = useRef<number>(0);
  
  // State Machine Refs
  const CLAW_TOP_HEIGHT = 50; // Fixed height for idle/aiming - raised for more tension
  const state = useRef<GameState>(GameState.WAITING_FOR_TOYS);
  const clawPos = useRef({ x: 0, y: CLAW_TOP_HEIGHT });
  const clawTargetPos = useRef({ x: 0, y: CLAW_TOP_HEIGHT });
  const clawDepth = useRef(0);
  const clawAngle = useRef(0); // 0 = Open, 1 = Closed
  const attachedToy = useRef<any>(null);
  const toyConstraint = useRef<any>(null);
  const countdownTimer = useRef(180); // 3 seconds at 60fps
  const isGripUnstable = useRef(false);
  const droppingToy = useRef<any>(null); // Track toy falling for success detection
  const targetDescentDepth = useRef(1); // Target descent depth (0-1), defaults to full descent
  const creditsRef = useRef(5); // Synchronous credit tracking to prevent race conditions
  const toysSettleTimer = useRef(0); // Timer for waiting for toys to settle

  // Pinch gesture edge detection (single pinch trigger)
  const lastGesture = useRef<GestureType>(GestureType.NONE);
  const hasTriggeredGrab = useRef(false); // Prevent multiple grabs from one pinch

  // OPEN gesture stability tracking for release
  const openGestureFrames = useRef(0);
  const OPEN_FRAMES_REQUIRED = 15; // Require 15 consecutive frames (~0.25s) to prevent false positives

  // UI State
  const [uiState, setUiState] = useState(GameState.WAITING_FOR_TOYS);
  const [debugGesture, setDebugGesture] = useState<string>('Initializing AI...');
  const [score, setScore] = useState(0);
  const [credits, setCredits] = useState(5);
  const [countdownValue, setCountdownValue] = useState(3);
  const [isReady, setIsReady] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    let active = true;

    const init = async () => {
      if (containerRef.current) {
        // Init Physics immediately so we see walls/toys
        physics.current.init(containerRef.current.clientWidth, containerRef.current.clientHeight);
        physics.current.spawnToys(40);

        // Set initial claw pos at fixed top height
        clawPos.current = { x: containerRef.current.clientWidth / 2, y: CLAW_TOP_HEIGHT };
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

    if (state.current !== uiState) {
      setUiState(state.current);
    }

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

    // Helper: Detect pinch gesture edge (transition from non-pinch to pinch)
    const isPinchTriggered = () => {
      const currentGesture = hand.gesture;
      const wasPinch = lastGesture.current === GestureType.PINCH;
      const isPinchNow = currentGesture === GestureType.PINCH;

      // Update last gesture for next frame
      lastGesture.current = currentGesture;

      // Return true only on rising edge (transition to PINCH)
      return !wasPinch && isPinchNow && hand.isPresent;
    };

    // Helper: Check if all toys have settled (velocity near zero)
    const areToysSettled = () => {
      const allBodies = Matter.Composite.allBodies(physics.current.engine.world);
      const toys = allBodies.filter(body => body.label === 'Toy');

      if (toys.length === 0) return false; // No toys found yet, keep waiting

      // Check if all toys have low velocity (settled) - relaxed threshold
      const velocityThreshold = 2.0; // Relaxed threshold - toys just need to be mostly settled
      return toys.every(toy => {
        const speed = Math.hypot(toy.velocity.x, toy.velocity.y);
        return speed < velocityThreshold;
      });
    };

    // WAITING_FOR_TOYS STATE - Wait for all toys to settle before countdown
    if (s === GameState.WAITING_FOR_TOYS) {
      toysSettleTimer.current++;

      // Maximum wait time: 5 seconds (300 frames at 60fps)
      const MAX_SETTLE_TIME = 300;

      if (areToysSettled() || toysSettleTimer.current >= MAX_SETTLE_TIME) {
        state.current = GameState.COUNTDOWN;
        setUiState(GameState.COUNTDOWN);
        toysSettleTimer.current = 0; // Reset timer
      }
      return;
    }

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

    // READY STATE - Allow hand movement and detect single PINCH to start grab
    if (s === GameState.READY) {
      // Ensure claw is OPEN in idle state
      clawAngle.current = 0;

      // Reset grab trigger flag when entering READY state
      hasTriggeredGrab.current = false;
      openGestureFrames.current = 0;

      // Force claw to stay at fixed top height (no vertical movement)
      clawPos.current.y = CLAW_TOP_HEIGHT;

      // Allow HORIZONTAL movement whenever hand is present (faster response)
      if (hand.isPresent) {
        const targetX = hand.x * width;
        clawPos.current.x += (targetX - clawPos.current.x) * 0.25; // Increased from 0.15 for less lag
      }

      // Check for PINCH TRIGGER (single pinch, not continuous hold) to start grab sequence
      if (isPinchTriggered() && creditsRef.current > 0 && !hasTriggeredGrab.current) {
        // Mark that we've triggered a grab
        hasTriggeredGrab.current = true;

        // Deduct credit synchronously to prevent race conditions
        creditsRef.current -= 1;
        setCredits(creditsRef.current);

        state.current = GameState.DESCENDING;

        // Raycast downward to find nearest toy
        const rayStart = { x: clawPos.current.x, y: clawPos.current.y };
        const rayEnd = { x: clawPos.current.x, y: height };
        const worldBodies = Matter.Composite.allBodies(physics.current.engine.world);

        // Call raycast with proper parameters (rayWidth = 5 for narrow vertical ray)
        const collisions = Matter.Query.ray(worldBodies, rayStart, rayEnd, 5);

        // Find the nearest toy
        let nearestToy = null;
        let nearestDistance = Infinity;

        for (const collision of collisions) {
          // Get the parent body (handles compound bodies correctly)
          const body = collision.body.parent || collision.body;

          // Filter for toys only
          if (body.label === 'Toy') {
            const distance = body.position.y - clawPos.current.y;
            if (distance > 0 && distance < nearestDistance) {
              nearestDistance = distance;
              nearestToy = body;
            }
          }
        }

        // Calculate target descent depth
        if (nearestToy) {
          // Find the top of the toy's HEAD ONLY (ignore ears)
          // parts[0] = self-reference, parts[1] = head (main body), parts[2+] = ears (visual only)
          let topY = Infinity;

          // Only scan the HEAD part (index 1) - ears are visual-only
          if (nearestToy.parts.length > 1 && nearestToy.parts[1].vertices) {
            const headPart = nearestToy.parts[1];
            for (const vertex of headPart.vertices) {
              if (vertex.y < topY) {
                topY = vertex.y;
              }
            }
          } else {
            // Fallback: single-part body, use all vertices
            for (const part of nearestToy.parts) {
              if (part.vertices) {
                for (const vertex of part.vertices) {
                  if (vertex.y < topY) {
                    topY = vertex.y;
                  }
                }
              }
            }
          }

          // Calculate depth as ratio: stop just above the toy's head
          const toyTopDistance = topY - clawPos.current.y - 40; // 40px clearance for claw prongs (reduced for difficulty)
          const targetDepth = Math.min(1, Math.max(0.1, toyTopDistance / maxExtension));
          targetDescentDepth.current = targetDepth;
        } else {
          // No toy found below - descend to ground level (90% of max)
          targetDescentDepth.current = 0.9;
        }
      }
      return;
    }

    // AUTOMATED GRAB SEQUENCE - Ignore all gestures
    switch (s) {
      case GameState.DESCENDING:
        // Slow, realistic descent - stop at target depth (toy or full)
        clawDepth.current += 0.012;
        if (clawDepth.current >= targetDescentDepth.current) {
          clawDepth.current = targetDescentDepth.current;
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

        // SLIP LOGIC: Realistic slip chances like real claw machines
        if (attachedToy.current) {
          // Base slip rates (per frame):
          // Stable grabs (0-7px): 0.35% per frame
          // Unstable grabs (>7px): 1.2% per frame
          let baseSlipChance = isGripUnstable.current ? 0.012 : 0.0035;

          // Early lift penalty: First 40% of lift has higher slip chance
          // This simulates the initial jerk when lifting starts
          const liftProgress = 1 - clawDepth.current; // 0 at bottom, 1 at top
          if (liftProgress < 0.4) {
            // Double the slip chance during early lift (realistic!)
            baseSlipChance *= 2;
          }

          if (Math.random() < baseSlipChance) {
            console.log('💧 TOY SLIPPED during LIFTING! Unstable:', isGripUnstable.current, 'Progress:', (liftProgress * 100).toFixed(1) + '%');
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

          console.log('📍 LIFTING完成! attachedToy:', attachedToy.current ? 'YES' : 'NO', 'constraint:', toyConstraint.current ? 'YES' : 'NO');

          // Check if we actually grabbed a toy
          if (attachedToy.current) {
            // SUCCESS - Move to CARRYING state (user can move and drop)
            console.log('✅ 进入CARRYING状态 - 玩具已抓稳！');
            state.current = GameState.CARRYING;
          } else {
            // FAILED GRAB - Open claw and return to READY
            console.log('❌ 抓取失败 - 返回READY状态');
            clawAngle.current = 0;
            state.current = GameState.READY;
            isGripUnstable.current = false;
          }
        }
        updateConstraint(maxExtension);
        break;

      case GameState.CARRYING:
        // Force claw to stay at fixed top height (no vertical movement)
        clawPos.current.y = CLAW_TOP_HEIGHT;

        // Allow HORIZONTAL movement whenever hand is present (any gesture)
        if (hand.isPresent) {
          const targetX = hand.x * width;
          clawPos.current.x += (targetX - clawPos.current.x) * 0.25;
        }

        updateConstraint(maxExtension);

        // Check if toy is still attached
        if (!attachedToy.current || !toyConstraint.current) {
          console.log('⚠️ CARRYING状态中玩具丢失! attachedToy:', attachedToy.current ? 'YES' : 'NO', 'constraint:', toyConstraint.current ? 'YES' : 'NO');
          state.current = GameState.READY;
          clawAngle.current = 0;
          openGestureFrames.current = 0;
          break;
        }

        // Track OPEN gesture - require stable detection to prevent false positives
        if (hand.isPresent && hand.gesture === GestureType.OPEN) {
          openGestureFrames.current++;
          console.log('🖐️ OPEN手势计数:', openGestureFrames.current, '/', OPEN_FRAMES_REQUIRED);
        } else {
          openGestureFrames.current = 0; // Reset if not OPEN
        }

        // Release when OPEN gesture is held stably
        if (openGestureFrames.current >= OPEN_FRAMES_REQUIRED) {
          console.log('✅ 稳定OPEN手势确认 - 释放玩具！');
          state.current = GameState.DROPPING;
          openGestureFrames.current = 0;
        }
        break;

      case GameState.DROPPING:
        // Reset OPEN gesture counter
        openGestureFrames.current = 0;

        // Open claw slowly
        if (clawAngle.current > 0) {
          clawAngle.current -= 0.025;
          if (clawAngle.current < 0) clawAngle.current = 0;
        }

        // Release constraint once
        if (toyConstraint.current) {
          Matter.World.remove(physics.current.engine.world, toyConstraint.current);
          toyConstraint.current = null;

          // Check if we dropped in EXIT zone with a toy
          const isInExitZone = clawPos.current.x >= exitZoneX;
          if (attachedToy.current && isInExitZone) {
            // Track toy for success detection (let it fall with physics)
            droppingToy.current = attachedToy.current;
          }
          // Clear attached toy
          attachedToy.current = null;
        }

        // Check if we're tracking a toy falling in exit zone
        if (droppingToy.current) {
          // Check if toy has fallen off screen
          if (droppingToy.current.position.y > height + 100) {
            // Remove toy from physics world
            physics.current.removeBody(droppingToy.current);
            droppingToy.current = null;

            // Increment score and show success message
            setScore(s => s + 1);
            setShowSuccess(true);
            setTimeout(() => {
              setShowSuccess(false);
            }, 2500);
          }
        }

        // Return to READY once claw is fully open and no toy being tracked
        if (clawAngle.current === 0 && !droppingToy.current) {
          state.current = GameState.READY;
          isGripUnstable.current = false;
        }
        break;
    }
  };

  const updateConstraint = (maxExtension: number) => {
    if (attachedToy.current && toyConstraint.current) {
        const depth = clawDepth.current;
        const extension = depth * maxExtension;
        const y = clawPos.current.y + extension;

        // Update anchor to follow claw tip (aligned with attemptGrab offset)
        toyConstraint.current.pointA = { x: clawPos.current.x, y: y + 60 };
    }
  };

  const attemptGrab = (maxExtension: number) => {
    // Claw tip position (visual)
    const depth = clawDepth.current;
    const extension = depth * maxExtension;
    const x = clawPos.current.x;
    const y = clawPos.current.y + extension + 60; // Adjusted grip center (was 80, now 60 for better accuracy)

    console.log('🎯 Attempting grab at claw position:', { x, y });

    // Grab radius: 22px (reduced for realistic difficulty)
    const toy = physics.current.findToyAt(x, y, 22);

    if (toy) {
      console.log('✅ Found toy! Position:', toy.position, 'Parts:', toy.parts.length);
      attachedToy.current = toy;

      // Calculate offset for "Slippery" logic
      const dist = Math.hypot(toy.position.x - x, toy.position.y - y);
      console.log('📏 Distance from claw to toy center:', dist, 'px');
      isGripUnstable.current = dist > 7; // If > 7px off-center, it's unstable (realistic threshold)

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
             ${uiState === GameState.WAITING_FOR_TOYS ? 'bg-orange-400 border-orange-600' :
               uiState === GameState.COUNTDOWN ? 'bg-yellow-400 border-yellow-600' :
               uiState === GameState.READY ? 'bg-blue-400 border-blue-600' :
               (uiState === GameState.DESCENDING || uiState === GameState.CLOSING || uiState === GameState.LIFTING) ? 'bg-purple-400 border-purple-600' :
               uiState === GameState.CARRYING ? 'bg-green-400 border-green-600' : 'bg-gray-400 border-gray-600'}`}>

              {uiState === GameState.WAITING_FOR_TOYS && (
                 <span className="flex items-center gap-2 animate-pulse"><span className="text-2xl">🎪</span> Toys Settling...</span>
              )}
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
                 <span className="flex items-center gap-2"><span className="text-2xl">✋</span> Open Hand to Release</span>
              )}
              {uiState === GameState.DROPPING && (
                 <span className="animate-pulse">Dropping...</span>
              )}
           </div>
        </div>

        {/* CENTER: Waiting for Toys Display */}
        {uiState === GameState.WAITING_FOR_TOYS && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            <div className="text-center">
              <div className="text-7xl mb-4 animate-bounce">🎪</div>
              <div className="text-5xl font-black text-white drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)] animate-pulse">
                Please Wait...
              </div>
              <div className="text-2xl font-bold text-white/80 mt-4">
                Toys are settling
              </div>
            </div>
          </div>
        )}

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
        {/* Only show when truly in READY state (not during active grab sequence) */}
        {creditsRef.current === 0 && state.current === GameState.READY && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
            <div className="bg-white/95 p-8 rounded-3xl shadow-2xl border-b-8 border-pink-400 max-w-sm">
              <div className="text-5xl mb-4 text-center">💰</div>
              <h2 className="text-2xl font-black text-pink-500 mb-3 text-center">Out of Credits!</h2>
              <p className="text-gray-600 mb-6 text-center">Purchase more credits to keep playing</p>
              <button
                className="w-full bg-gray-400 text-white font-bold text-xl py-4 rounded-xl shadow-lg cursor-not-allowed opacity-60"
                disabled
              >
                Add Credits (Coming Soon)
              </button>
            </div>
          </div>
        )}

        {/* SUCCESS MESSAGE: Shown after toy falls off screen in exit zone */}
        {showSuccess && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            <div className="bg-gradient-to-br from-yellow-300 to-yellow-400 p-10 rounded-3xl shadow-2xl border-b-8 border-r-8 border-yellow-600 max-w-md animate-bounce">
              <div className="text-7xl mb-4 text-center">🎉</div>
              <h2 className="text-4xl font-black text-white drop-shadow-lg mb-3 text-center">SUCCESS!</h2>
              <p className="text-yellow-900 font-bold text-xl text-center">Congratulations! You caught a prize!</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};