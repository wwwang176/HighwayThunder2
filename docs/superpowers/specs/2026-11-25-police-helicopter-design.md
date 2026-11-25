# Police helicopter (highway chase)

Approved by the user 2026-11-25 ("OK 開工"), on branch feat/police-chase.

## Intent

Visual impact for the police chase: a helicopter over the player with a searchlight on them, at night. Pure show:
it never touches anything and does not change the chase (the police's own logic stays as it is).

## What it is (the user's calls)

- **Shape**: no model file - primitives the eye reads as a helicopter from far below: a tapered body (cone /
  capsule), a tail boom, a tail fin, a tail rotor, skids, a two-blade main rotor (two crossed thin boards spinning,
  plus a faint translucent disc for the blur). Dark. Navigation lights: red and green, a white strobe.
- **Flight**: scripted, no planner: a fixed height, sliding slowly fore and aft, now on the left, now on the right
  (smooth changes). Never collides.
- **Searchlight**: one, on a racer:
  - a translucent cone from the helicopter to the car (additive, both sides, no depth write - from inside and out);
  - glare when the camera looks into the light: a cross-flare sprite at the lamp (fixed size on screen, no depth
    test) and a faint full-screen veil - as grok-aircraft2's src/render/searchlights.ts, but times how squarely the
    camera faces the lamp (our camera follows the lit car: usually in the beam, looking away);
  - a real spot light lighting the ground (no shadow; in the scene throughout, intensity 0 when off: a light coming
    and going rebuilds every material).
- **Sound**: rotor "whop-whop" synthesized here (no recordings): blade-pass pulses, panned, quieter with distance,
  Doppler-shifted, at the race's time scale.
- **Busted**: in the slow-motion orbit it keeps hovering, its light on the player.

## My calls (stated to the user)

- ~~The light on the player only; sliding 60-110 m ahead of them.~~ Changed by the user (2026-11-25): it circles
  its car loosely (behind it at times, ahead at others), its height wandering; pitched and banked as its path
  speeds up, slows and turns (scripted from the path, no physics); it lights the AI racers too.
- **Where**: an ellipse round its car along the road, -45..95 m along, +-28 m across, a lap in ~45 s (its pace
  wandering), 25-35 m up (HELI in src/game/helicopter.ts).
- **Whose car** (my call): the player half the time, else a rival within 150 m of the player (in their sight), a
  new roll every ~20 s; back to the player when that rival is 250 m off, and when busted. The light and the circling
  swing over to a new car apart, as two people's (the user's call): the light in 2 s, the helicopter in 8 s (both
  in 4 s at first, then 2 s: the helicopter lurched up to 150 m in it).
- **Veil** only with the camera inside the beam (up to the lit car); the flare a little further (the chase camera
  behind the car looking up the beam) - the veil there greyed the whole view.
- **Coming in** (the user's call, 2026-11-25): from far behind and high - 450 m back, 90 m over its height (~120 m
  up) - over 14 s, catching up and coming down over the car into its circle ahead; its searchlight off till it is
  down, on over 0.6 s: seen and heard first, then the light. Its circle starts as it comes down (ahead of the car).
- **Busted**: the slow-motion orbit 66% slower (0.306 rad/s), the rotor half as loud while it lasts.
- **When**: from the chase's start (Police.triggered), flying in as above (300 m back over 10 s; from ahead before that); then the rest of
  the race. Highway, police on only (it lives and dies with Police).
- Moves on the race's time (`play`): still when paused.

## Shadows (added 2026-11-25, the user's call)

- The searchlight's spot light casts shadows: the traffic in its narrow cone (trucks, containers, cars) shadows the
  road; the lit air in the shaft reads the same map (a truck cuts a gap in it, as much as it blocks). Its map: 512
  px over the 40 m of the beam above the lit car, drawn only while it flies; the shaft reads it only there.
- Vehicles' bodies receive no shadows (as before, for every light): a car in a truck's shadow is still lit by the
  searchlight. The user kept it so rather than let every shadowed light (headlights too) shadow the cars' bodies.
- Cost, one paused frame at 2402x1350: within the measurement's noise (~6-7 ms a frame either way).

## Build

- `src/game/helicopter.ts`: the pure schedule (`heliOffset(t)`: ahead and side at time t; `beamGlare(axial,
  radial, facing)`) - unit-tested (tests/helicopter.test.ts); class `Helicopter` (the primitives, the beam, glare,
  veil, spot light; `update(play, player, place, camera, active)`, `reset()`, `dispose()`).
- `src/audio/rotor.ts`: the rotor voice (as siren.ts); `Sound.setRotor(...)`.
- `src/game/game.ts`: made and disposed with Police; reset at each race's start; updated after the camera is placed;
  heard with the sirens.
