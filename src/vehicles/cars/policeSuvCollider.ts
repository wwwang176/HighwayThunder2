// police-suv's collision shape: convex pieces of points (x, y, z in body space, m: x right, y up - the ground 0.55 m
// below -, the nose toward -z). Kept by hand (the model hardly changes): change a point, then see it over the car in
// tools/models/police_suv.py's preview (collider-*.png).
export const POLICE_SUV_COLLIDER: number[][] = [
  // The body: from the underside up to the belt line, the push bar to the rear bumper (not the mirrors).
  [
    -0.99, -0.317, -2.486, // left, the push bar, underside
    -0.99, 0.68, -2.486, // left, the push bar, the belt
    0.99, -0.317, -2.486, // right, the push bar, underside
    0.99, 0.68, -2.486, // right, the push bar, the belt
    -0.99, -0.317, 2.476, // left, the tail, underside
    -0.99, 0.68, 2.476, // left, the tail, the belt
    0.99, -0.317, 2.476, // right, the tail, underside
    0.99, 0.68, 2.476, // right, the tail, the belt
  ],
  // The cabin: the belt up to the roof, narrower up top; its front leaning back as the windscreen.
  [
    -0.95, 0.68, -0.95, // left, the windscreen's foot
    0.95, 0.68, -0.95, // right, the windscreen's foot
    -0.95, 0.68, 2.4, // left, the tailgate, the belt
    0.95, 0.68, 2.4, // right, the tailgate, the belt
    -0.65, 1.14, -0.3, // left, the roof's front
    0.65, 1.14, -0.3, // right, the roof's front
    -0.65, 1.14, 2.3, // left, the roof's back
    0.65, 1.14, 2.3, // right, the roof's back
  ],
];
