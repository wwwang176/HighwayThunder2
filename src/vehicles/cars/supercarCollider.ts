// supercar's collision shape: convex pieces of points (x, y, z in body space, m: x right, y up -
// the ground 0.55 m below -, the nose toward -z). Kept by hand (the model hardly changes): change a point,
// then see it over the car in tools/models/supercar.py's preview (collider-*.png).
export const SUPERCAR_COLLIDER: number[][] = [
  // The body: from the underside up to the hood (and the deck), nose to tail.
  [
    -0.383, -0.330, -2.268, // left, the nose, underside
    -0.383, -0.026, -2.268, // left, the nose, top
    0.383, -0.330, -2.268, // right, the nose, underside
    0.383, -0.026, -2.268, // right, the nose, top
    -0.383, -0.338, -2.186, // left, 92% of the way to the nose, underside
    -0.383, -0.005, -2.186, // left, 92% of the way to the nose, top
    0.383, -0.338, -2.186, // right, 92% of the way to the nose, underside
    0.383, -0.005, -2.186, // right, 92% of the way to the nose, top
    -0.850, -0.356, -2.013, // left, 75% of the way to the nose, underside
    -0.850, 0.038, -2.013, // left, 75% of the way to the nose, top
    0.850, -0.356, -2.013, // right, 75% of the way to the nose, underside
    0.850, 0.038, -2.013, // right, 75% of the way to the nose, top
    -0.921, -0.428, -1.334, // left, the windscreen's foot, underside
    -0.921, 0.207, -1.334, // left, the windscreen's foot, top
    0.921, -0.428, -1.334, // right, the windscreen's foot, underside
    0.921, 0.207, -1.334, // right, the windscreen's foot, top
    -1.000, -0.437, -1.250, // left, the front axle, underside
    -1.000, 0.214, -1.250, // left, the front axle, top
    1.000, -0.437, -1.250, // right, the front axle, underside
    1.000, 0.214, -1.250, // right, the front axle, top
    -1.000, -0.437, 1.250, // left, the rear axle, underside
    -1.000, 0.430, 1.250, // left, the rear axle, top
    1.000, -0.437, 1.250, // right, the rear axle, underside
    1.000, 0.430, 1.250, // right, the rear axle, top
    -0.806, -0.359, 1.988, // left, 75% of the way to the tail, underside
    -0.806, 0.494, 1.988, // left, 75% of the way to the tail, top
    0.806, -0.359, 1.988, // right, 75% of the way to the tail, underside
    0.806, 0.494, 1.988, // right, 75% of the way to the tail, top
    -0.789, -0.341, 2.156, // left, 92% of the way to the tail, underside
    -0.789, 0.508, 2.156, // left, 92% of the way to the tail, top
    0.789, -0.341, 2.156, // right, 92% of the way to the tail, underside
    0.789, 0.508, 2.156, // right, 92% of the way to the tail, top
    -0.789, -0.333, 2.234, // left, the tail, underside
    -0.789, 0.515, 2.234, // left, the tail, top
    0.789, -0.333, 2.234, // right, the tail, underside
    0.789, 0.515, 2.234, // right, the tail, top
  ],
  // The cabin: the windscreen's foot, up to the roof, its height carried back over the engine's glass to the tail.
  [
    -0.806, 0.162, -1.334, // left, the windscreen's foot (the sill)
    -0.498, 0.586, 2.182, // left, the roof's height at the tail
    -0.498, 0.586, 0.261, // left, the roof, behind its middle
    -0.806, 0.471, 2.190, // left, the tail, the deck's height
    0.806, 0.162, -1.334, // right, the windscreen's foot (the sill)
    0.498, 0.586, 2.182, // right, the roof's height at the tail
    0.498, 0.586, 0.261, // right, the roof, behind its middle
    0.806, 0.471, 2.190, // right, the tail, the deck's height
  ],
];
