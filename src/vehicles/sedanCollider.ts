// The traffic sedan's collision shape (as the JDM's, src/vehicles/cars/jdmCollider.ts): convex pieces of points (x, y, z in
// its body's space, m: x right, y up from the body's middle - the ground 0.69 m below -, the nose toward -z),
// measured off its model (public/models/sedan.glb) and kept by hand (the model doesn't change). Its underside 0.3 m
// above the road all along, as its box's was (clear of the road's bumps; the wheels are rays).
export const SEDAN_COLLIDER: number[][] = [
  // The body: up to the hood, the windows' sills and the deck, nose to tail.
  [
    -0.450, -0.390, -2.128, // left, the nose, underside
    -0.450, -0.140, -2.128, // left, the nose, top
     0.450, -0.390, -2.128, // right, the nose, underside
     0.450, -0.140, -2.128, // right, the nose, top
    -0.740, -0.390, -1.978, // left, the nose's top edge, underside
    -0.740,  0.040, -1.978, // left, the nose's top edge, top
     0.740, -0.390, -1.978, // right, the nose's top edge, underside
     0.740,  0.040, -1.978, // right, the nose's top edge, top
    -0.810, -0.390, -1.828, // left, the hood's front, underside
    -0.810,  0.120, -1.828, // left, the hood's front, top
     0.810, -0.390, -1.828, // right, the hood's front, underside
     0.810,  0.120, -1.828, // right, the hood's front, top
    -0.850, -0.390, -1.278, // left, the front axle, underside
    -0.850,  0.210, -1.278, // left, the front axle, top
     0.850, -0.390, -1.278, // right, the front axle, underside
     0.850,  0.210, -1.278, // right, the front axle, top
    -0.850, -0.390, -0.878, // left, the windscreen's foot, underside
    -0.850,  0.280, -0.878, // left, the windscreen's foot, top
     0.850, -0.390, -0.878, // right, the windscreen's foot, underside
     0.850,  0.280, -0.878, // right, the windscreen's foot, top
    -0.830, -0.390,  1.522, // left, the rear window's foot, underside
    -0.830,  0.310,  1.522, // left, the rear window's foot, top
     0.830, -0.390,  1.522, // right, the rear window's foot, underside
     0.830,  0.310,  1.522, // right, the rear window's foot, top
    -0.770, -0.390,  1.922, // left, the deck's back, underside
    -0.770,  0.300,  1.922, // left, the deck's back, top
     0.770, -0.390,  1.922, // right, the deck's back, underside
     0.770,  0.300,  1.922, // right, the deck's back, top
    -0.750, -0.390,  2.042, // left, the tail, underside
    -0.750,  0.260,  2.042, // left, the tail, top
     0.750, -0.390,  2.042, // right, the tail, underside
     0.750,  0.260,  2.042, // right, the tail, top
  ],
  // The cabin: the windscreen's foot, over the roof (narrower than the body), down to the rear window's foot.
  [
    -0.720,  0.280, -0.878, // left, the windscreen's foot (the sill)
    -0.570,  0.686, -0.398, // left, the windscreen's top (the roof)
    -0.570,  0.670,  0.982, // left, the rear window's top (the roof)
    -0.720,  0.308,  1.522, // left, the rear window's foot (the sill)
     0.720,  0.280, -0.878, // right, the windscreen's foot (the sill)
     0.570,  0.686, -0.398, // right, the windscreen's top (the roof)
     0.570,  0.670,  0.982, // right, the rear window's top (the roof)
     0.720,  0.308,  1.522, // right, the rear window's foot (the sill)
  ],
];
