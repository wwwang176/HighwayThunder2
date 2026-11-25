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

- The light is on the **player** (the impact is for the player).
- **Where**: ahead of and above the player (the chase camera looks ahead): ~40 m up, 20-60 m ahead (fore/aft
  slide), ~15 m to a side, the side changing every so often; along the road (Centerline.toWorld).
- **When**: from the chase's start (Police.triggered), flying in from far ahead over a few seconds; then the rest of
  the race. Highway, police on only (it lives and dies with Police).
- Moves on the race's time (`play`): still when paused.

## Build

- `src/game/helicopter.ts`: the pure schedule (`heliOffset(t)`: ahead and side at time t; `beamGlare(axial,
  radial, facing)`) - unit-tested (tests/helicopter.test.ts); class `Helicopter` (the primitives, the beam, glare,
  veil, spot light; `update(play, player, place, camera, active)`, `reset()`, `dispose()`).
- `src/audio/rotor.ts`: the rotor voice (as siren.ts); `Sound.setRotor(...)`.
- `src/game/game.ts`: made and disposed with Police; reset at each race's start; updated after the camera is placed;
  heard with the sirens.
