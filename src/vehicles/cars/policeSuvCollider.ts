// police-suv's collision shape: convex pieces of points (x, y, z in body space, m: x right, y up - the ground 0.55 m
// below -, the nose toward -z). Kept by hand (the model hardly changes): change a point, then see it over the car in
// tools/models/police_suv.py's preview (collider-*.png).
export const POLICE_SUV_COLLIDER: number[][] = [
  // The body: from the underside up to the belt line, the push bar to the rear bumper (not the mirrors).
  [
    -0.99, -0.317, -2.467, // left, the push bar, underside
    -0.99, 0.68, -2.467, // left, the push bar, the belt
    0.99, -0.317, -2.467, // right, the push bar, underside
    0.99, 0.68, -2.467, // right, the push bar, the belt
    -0.99, -0.317, 2.495, // left, the tail, underside
    -0.99, 0.68, 2.495, // left, the tail, the belt
    0.99, -0.317, 2.495, // right, the tail, underside
    0.99, 0.68, 2.495, // right, the tail, the belt
  ],
  // The cabin: the belt up to the roof, narrower up top; its front leaning back as the windscreen.
  [
    -0.95, 0.68, -0.931, // left, the windscreen's foot
    0.95, 0.68, -0.931, // right, the windscreen's foot
    -0.95, 0.68, 2.419, // left, the tailgate, the belt
    0.95, 0.68, 2.419, // right, the tailgate, the belt
    -0.65, 1.14, -0.281, // left, the roof's front
    0.65, 1.14, -0.281, // right, the roof's front
    -0.65, 1.14, 2.319, // left, the roof's back
    0.65, 1.14, 2.319, // right, the roof's back
  ],
];
