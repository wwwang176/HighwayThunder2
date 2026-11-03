// jdm's collision shape: convex pieces of points (x, y, z in body space, m: x right, y up -
// the ground 0.55 m below -, the nose toward -z). Kept by hand (the model hardly changes): change a point,
// then see it over the car in tools/models/jdm.py's preview (collider-*.png).
export const JDM_COLLIDER: number[][] = [
  // The body: from the underside up to the hood (and the deck), nose to tail.
  [
    -0.891, -0.296, -2.109, // left, the nose, underside
    -0.891, 0.096, -2.109, // left, the nose, top
    0.891, -0.296, -2.109, // right, the nose, underside
    0.891, 0.096, -2.109, // right, the nose, top
    -0.891, -0.328, -1.929, // left, 80% of the way to the nose, underside
    -0.891, 0.128, -1.929, // left, 80% of the way to the nose, top
    0.891, -0.328, -1.929, // right, 80% of the way to the nose, underside
    0.891, 0.128, -1.929, // right, 80% of the way to the nose, top
    -0.891, -0.376, -1.659, // left, 50% of the way to the nose, underside
    -0.891, 0.176, -1.659, // left, 50% of the way to the nose, top
    0.891, -0.376, -1.659, // right, 50% of the way to the nose, underside
    0.891, 0.176, -1.659, // right, 50% of the way to the nose, top
    -0.960, -0.455, -1.210, // left, the front axle, underside
    -0.960, 0.256, -1.210, // left, the front axle, top
    0.960, -0.455, -1.210, // right, the front axle, underside
    0.960, 0.256, -1.210, // right, the front axle, top
    -0.960, -0.455, -0.757, // left, the windscreen's foot, underside
    -0.960, 0.337, -0.757, // left, the windscreen's foot, top
    0.960, -0.455, -0.757, // right, the windscreen's foot, underside
    0.960, 0.337, -0.757, // right, the windscreen's foot, top
    -0.960, -0.455, 1.210, // left, the rear axle, underside
    -0.960, 0.609, 1.210, // left, the rear axle, top
    0.960, -0.455, 1.210, // right, the rear axle, underside
    0.960, 0.609, 1.210, // right, the rear axle, top
    -0.848, -0.360, 1.750, // left, 50% of the way to the tail, underside
    -0.848, 0.684, 1.750, // left, 50% of the way to the tail, top
    0.848, -0.360, 1.750, // right, 50% of the way to the tail, underside
    0.848, 0.684, 1.750, // right, 50% of the way to the tail, top
    -0.822, -0.303, 2.074, // left, 80% of the way to the tail, underside
    -0.822, 0.729, 2.074, // left, 80% of the way to the tail, top
    0.822, -0.303, 2.074, // right, 80% of the way to the tail, underside
    0.822, 0.729, 2.074, // right, 80% of the way to the tail, top
    -0.805, -0.265, 2.290, // left, the tail, underside
    -0.805, 0.759, 2.290, // left, the tail, top
    0.805, -0.265, 2.290, // right, the tail, underside
    0.805, 0.759, 2.290, // right, the tail, top
  ],
  // The cabin: the windscreen's foot, over the roof, down to the rear window's foot.
  [
    -0.710, 0.333, -0.757, // left, the windscreen's foot (the sill)
    -0.555, 0.741, -0.224, // left, the windscreen's top (the roof)
    -0.555, 0.741, 1.102, // left, the rear window's top (the roof)
    -0.710, 0.380, 1.627, // left, the rear window's foot (the sill)
    0.710, 0.333, -0.757, // right, the windscreen's foot (the sill)
    0.555, 0.741, -0.224, // right, the windscreen's top (the roof)
    0.555, 0.741, 1.102, // right, the rear window's top (the roof)
    0.710, 0.380, 1.627, // right, the rear window's foot (the sill)
  ],
];
