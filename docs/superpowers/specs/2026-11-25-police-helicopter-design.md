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
- **Sound**: rotor "whop-whop", panned, quieter with distance, Doppler-shifted, at the race's time scale.
  ~~Synthesized here (blade-pass pulses).~~ Changed by the user (2026-11-26): a recording of a helicopter hovering
  (one seamless lap of it looped, in its own bundle - docs/sound.md); the synthesized one removed (no bundle: silent,
  as every sound).
- **Busted**: in the slow-motion orbit it keeps hovering, its light on the player.

## My calls (stated to the user)

- ~~The light on the player only; sliding 60-110 m ahead of them.~~ Changed by the user (2026-11-25): it circles
  its car loosely (behind it at times, ahead at others), its height wandering; pitched and banked as its path
  speeds up, slows and turns (scripted from the path, no physics); it lights the AI racers too.
- **Where**: an ellipse round its car along the road, -45..95 m along, +-28 m across, a lap in ~45 s (its pace
  wandering), 25-35 m up (HELI in src/game/helicopter.ts).
- **Whose car** (the user's call, 2026-11-25): the player first; every ~10 s (7.5-12.5 s, the first 10 s after the
  light comes on) another racer, any but the one it lights, each as likely; the player when busted. (My call before:
  the player half the time, else a rival within 150 m of them, a roll every ~20 s - it seemed never to change.) The
  light and the circling
  swing over to a new car apart, as two people's (the user's call): the light in 2 s, the helicopter in 3 s at least,
  never pulling harder than 25 m/s^2, leaning no more than its limits (both in 4 s at first, then 2 s: the helicopter
  lurched up to 150 m in it; then 8 s and 5 m/s^2, then 5 s and 10, then 20 - 2026-11-27, the user's call: too slow over to the
  player, its light out of reach the while). Its ~10 s over a car counted from when it
  is there (2026-11-26, the user's call: counted from the switch, its 8-17 s flight over ate it - it left a car as
  soon as it got there). Its car put back (a rival far off brought 200 m from the player, a reset) flown to as to a new
  car (2026-11-26, the user's call: it jumped with it).
- **Veil** only with the camera inside the beam (up to the lit car); the flare a little further (the chase camera
  behind the car looking up the beam) - the veil there greyed the whole view.
- **Coming in** (the user's call, 2026-11-25): from far behind and high - 450 m back, 90 m over its height (~120 m
  up) - over 14 s, catching up and coming down over the car into its circle ahead; its searchlight off till it is
  down, on over 0.6 s: seen and heard first, then the light. Its circle starts as it comes down (ahead of the car).
- **The light's tilt** (the user's call, 2026-11-26): never more than 60 degrees off straight down, its hand's
  wander too - a car far off (just picked, the helicopter on its way) lit on the ground short of it, the way to it,
  not by a beam lying along the ground; on it once it is near. (Its circling is 36-74 degrees off straight down, 55
  the median: on its car ~60% of the time; 45 degrees would have been 20%.) A car out of reach lit on its lane, as
  near it as it reaches (2026-11-26, the user's call: short of it on the straight line to it, it lit the city - the
  helicopter out to the side of its circle, the line to a car far off along the road); its swing to a new car along
  the road too.
- **Facing** (the user's call, 2026-11-26): its nose along its way from 100 km/h; under 60 km/h toward its car (it
  circles sideways, watching it); between the two in between. It leans the way it goes, sideways too.
- **Rotors** (2026-11-26): blurred blades on a disc each (render/rotorBlur), the pattern at its own pace (the
  rotor's own beats with the frame rate); the body grey-white (dark, it was not to be seen at night).
- **Busted**: the slow-motion orbit 66% slower (0.306 rad/s), the rotor half as loud while it lasts (since 2026-11-26 with all the race's sound: docs/sound.md).
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
- `src/audio/rotor.ts`: the rotor voice (its recording looped, placed as siren.ts); `Sound.setRotor(...)`.
- `src/game/game.ts`: made and disposed with Police; reset at each race's start; updated after the camera is placed;
  heard with the sirens.
