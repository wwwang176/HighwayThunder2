// muscle-car's collision shape: convex pieces of points (x, y, z in body space, m: x right, y up -
// the ground 0.55 m below -, the nose toward -z). Kept by hand (the model hardly changes): change a point,
// then see it over the car in tools/models/muscle_car.py's preview (collider-*.png).
export const MUSCLE_CAR_COLLIDER: number[][] = [
  // The body: from the underside up to the hood (and the deck), nose to tail.
  [
    -0.818, -0.194, -2.133, // left, the nose, underside
    -0.818, 0.388, -2.133, // left, the nose, top
    0.818, -0.194, -2.133, // right, the nose, underside
    0.818, 0.388, -2.133, // right, the nose, top
    -0.818, -0.224, -1.960, // left, 80% of the way to the nose, underside
    -0.818, 0.391, -1.960, // left, 80% of the way to the nose, top
    0.818, -0.224, -1.960, // right, 80% of the way to the nose, underside
    0.818, 0.391, -1.960, // right, 80% of the way to the nose, top
    -0.836, -0.270, -1.700, // left, 50% of the way to the nose, underside
    -0.836, 0.395, -1.700, // left, 50% of the way to the nose, top
    0.836, -0.270, -1.700, // right, 50% of the way to the nose, underside
    0.836, 0.395, -1.700, // right, 50% of the way to the nose, top
    -0.995, -0.346, -1.268, // left, the front axle, underside
    -0.995, 0.403, -1.268, // left, the front axle, top
    0.995, -0.346, -1.268, // right, the front axle, underside
    0.995, 0.403, -1.268, // right, the front axle, top
    -0.995, -0.346, 1.268, // left, the rear axle, underside
    -0.995, 0.448, 1.268, // left, the rear axle, top
    0.995, -0.346, 1.268, // right, the rear axle, underside
    0.995, 0.448, 1.268, // right, the rear axle, top
    -0.871, -0.248, 1.827, // left, 50% of the way to the tail, underside
    -0.871, 0.458, 1.827, // left, 50% of the way to the tail, top
    0.871, -0.248, 1.827, // right, 50% of the way to the tail, underside
    0.871, 0.458, 1.827, // right, 50% of the way to the tail, top
    -0.871, -0.188, 2.163, // left, 80% of the way to the tail, underside
    -0.871, 0.464, 2.163, // left, 80% of the way to the tail, top
    0.871, -0.188, 2.163, // right, 80% of the way to the tail, underside
    0.871, 0.464, 2.163, // right, 80% of the way to the tail, top
    -0.871, -0.149, 2.386, // left, the tail, underside
    -0.871, 0.467, 2.386, // left, the tail, top
    0.871, -0.149, 2.386, // right, the tail, underside
    0.871, 0.467, 2.386, // right, the tail, top
  ],
  // The cabin: the windscreen's foot, over the roof, down to the rear window's foot.
  [
    -0.739, 0.361, -0.532, // left, the windscreen's foot (the sill)
    -0.579, 0.724, -0.143, // left, the windscreen's top (the roof)
    -0.579, 0.724, 1.042, // left, the rear window's top (the roof)
    -0.739, 0.459, 1.458, // left, the rear window's foot (the sill)
    0.739, 0.361, -0.532, // right, the windscreen's foot (the sill)
    0.579, 0.724, -0.143, // right, the windscreen's top (the roof)
    0.579, 0.724, 1.042, // right, the rear window's top (the roof)
    0.739, 0.459, 1.458, // right, the rear window's foot (the sill)
  ],
];
