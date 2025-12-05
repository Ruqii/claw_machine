import { GameState } from '../types';

declare const Matter: any;

export class PhysicsWorld {
  public engine: any;
  public width: number = 0;
  public height: number = 0;
  
  // Track static bodies to move them on resize
  private walls: any = {
    ground: null,
    left: null,
    right: null, // We keep right wall for the "Edge" of the machine, but ground stops earlier
    separator: null
  };

  private colors = ['#f9a8d4', '#fcd34d', '#a5f3fc', '#c4b5fd', '#86efac', '#fda4af'];

  constructor(options?: any) {
    this.engine = Matter.Engine.create();
    this.engine.world.gravity.y = 1.0; 
  }

  init(width: number, height: number) {
    if (this.walls.ground) return; // Already initialized

    this.width = width;
    this.height = height;
    
    // Geometry Constants
    const floorThickness = 100;
    const floorY = (height - 30) + (floorThickness / 2);
    const pitWidth = width * 0.75; // 75% Play Area

    // 1. GROUND (Left 75% only)
    this.walls.ground = Matter.Bodies.rectangle(
        pitWidth / 2, 
        floorY, 
        pitWidth, 
        floorThickness, 
        { isStatic: true, label: 'Ground' }
    );

    // 2. LEFT WALL
    this.walls.left = Matter.Bodies.rectangle(
        -50, 
        height / 2, 
        100, 
        height * 2, 
        { isStatic: true, label: 'Wall' }
    );

    // 3. RIGHT WALL (Far right edge of screen, prevents claw going off screen, but no floor below)
    this.walls.right = Matter.Bodies.rectangle(
        width + 50, 
        height / 2, 
        100, 
        height * 2, 
        { isStatic: true, label: 'Wall' }
    );

    // 4. SEPARATOR (The barrier between Pit and Exit)
    // Located at 75% width. Height ~120px to hold toys in.
    const separatorHeight = 220;
    this.walls.separator = Matter.Bodies.rectangle(
        pitWidth, 
        height - 30 - (separatorHeight / 2), 
        20, 
        separatorHeight, 
        { 
            isStatic: true, 
            label: 'Separator',
            render: { fillStyle: '#fbcfe8' }
        }
    );
    
    Matter.World.add(this.engine.world, [
        this.walls.ground, 
        this.walls.left, 
        this.walls.right,
        this.walls.separator
    ]);
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;

    if (this.walls.ground) {
        const floorThickness = 100;
        const floorY = (height - 30) + (floorThickness / 2);
        const pitWidth = width * 0.75;
        const separatorHeight = 220;

        Matter.Body.setPosition(this.walls.ground, { x: pitWidth / 2, y: floorY });
        // Need to recreate or scale rect for width changes properly in Matter.js, 
        // but for simple resize, we can just position. 
        // Note: Changing width of static body in Matter.js is tricky without recreating.
        // For this demo, assuming minor resizes or we'd need to recreate the bodies.
        
        // Reposition Separator
        Matter.Body.setPosition(this.walls.separator, { x: pitWidth, y: height - 30 - (separatorHeight / 2) });
        Matter.Body.setPosition(this.walls.right, { x: width + 50, y: height / 2 });
    }
  }

  spawnToys(count: number) {
    // Clear existing toys?
    const bodies = Matter.Composite.allBodies(this.engine.world);
    bodies.forEach((b: any) => {
        if (b.label === 'Toy') Matter.World.remove(this.engine.world, b);
    });

    // Spawn toys in multiple layers for a dense, realistic look
    for (let i = 0; i < count; i++) {
      // Spawn only in the pit area (0 to 70% width)
      const x = Math.random() * (this.width * 0.6) + (this.width * 0.05);
      // Distribute vertically across multiple layers (-1500 to -100)
      // This creates a fuller, more realistic pile
      const y = Math.random() * -1400 - 100;
      this.createKawaiiToy(x, y);
    }
  }

  createKawaiiToy(x: number, y: number) {
    const type = Math.random();
    const color = this.colors[Math.floor(Math.random() * this.colors.length)];
    const scale = 0.9 + Math.random() * 0.3;

    // Physics properties - applied ONLY to compound body
    const compoundOptions = {
      restitution: 0.0,   // No bounce, dead weight
      friction: 0.9,      // High friction
      frictionAir: 0.08, // Low air resistance (falls fast)
      density: 0.4,      // Heavy density
      label: 'Toy',
      render: { fillStyle: color, strokeStyle: '#334155', lineWidth: 3 }
    };

    // Step 1: Create main body with physics options
    const body = Matter.Body.create(compoundOptions);

    if (type < 0.33) {
      // BEAR: Head + 2 Ears
      // Step 2: Create parts at RELATIVE positions (0,0) center
      const head = Matter.Bodies.circle(0, 0, 25 * scale);
      const leftEar = Matter.Bodies.circle(-20 * scale, -22 * scale, 12 * scale);
      const rightEar = Matter.Bodies.circle(20 * scale, -22 * scale, 12 * scale);

      // Step 3: Use setParts to create rigid compound body
      Matter.Body.setParts(body, [body, head, leftEar, rightEar]);

      // Step 4: Position the entire compound body at world coordinates
      Matter.Body.setPosition(body, { x: x, y: y });
    } else if (type < 0.66) {
      // BUNNY: Head + 2 Long Ears
      // Step 2: Create parts at RELATIVE positions (0,0) center
      const head = Matter.Bodies.circle(0, 0, 24 * scale);
      const leftEar = Matter.Bodies.rectangle(-12 * scale, -35 * scale, 12 * scale, 35 * scale, { chamfer: { radius: 6 } });
      const rightEar = Matter.Bodies.rectangle(12 * scale, -35 * scale, 12 * scale, 35 * scale, { chamfer: { radius: 6 } });

      // Step 3: Use setParts to create rigid compound body
      Matter.Body.setParts(body, [body, head, leftEar, rightEar]);

      // Step 4: Position the entire compound body at world coordinates
      Matter.Body.setPosition(body, { x: x, y: y });
    } else {
      // CUBE CAT: Rounded Box + Triangle Ears
      // Step 2: Create parts at RELATIVE positions (0,0) center
      const head = Matter.Bodies.rectangle(0, 0, 48 * scale, 42 * scale, { chamfer: { radius: 12 } });
      const leftEar = Matter.Bodies.polygon(-18 * scale, -25 * scale, 3, 12 * scale);
      const rightEar = Matter.Bodies.polygon(18 * scale, -25 * scale, 3, 12 * scale);

      Matter.Body.rotate(leftEar, -0.4);
      Matter.Body.rotate(rightEar, 0.4);

      // Step 3: Use setParts to create rigid compound body
      Matter.Body.setParts(body, [body, head, leftEar, rightEar]);

      // Step 4: Position the entire compound body at world coordinates
      Matter.Body.setPosition(body, { x: x, y: y });
    }

    Matter.World.add(this.engine.world, body);
  }

  findToyAt(x: number, y: number, radius: number) {
    const bodies = Matter.Composite.allBodies(this.engine.world);
    let closest = null;
    let minDist = radius;

    for (const body of bodies) {
      if (body.label !== 'Toy') continue;
      
      // Rough distance check to CoM
      const dist = Math.hypot(body.position.x - x, body.position.y - y);
      if (dist < minDist) {
        minDist = dist;
        closest = body;
      }
    }
    return closest;
  }

  removeBody(body: any) {
    Matter.World.remove(this.engine.world, body);
  }
}