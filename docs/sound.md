# Sound

Every sound in the game is a recording licensed for use inside the game only, so:

- **No audio is ever committed.** Not a recording, not a processed clip, not a built bundle - in any format.
  `public/audio/` is git-ignored, and `tests/noLicensedAudio.test.ts` fails if any audio file is tracked.
- The game ships them packed into scrambled bundles (`public/audio/engines.bin`, `crashes.bin`, `effects.bin`;
  `src/audio/bundleCodec.ts`), never as loose clips.
- The bundles, their build tools and the music live in a private repository, checked out by the Pages workflow and
  copied into `public/audio` just for the build. Without them (any checkout of this repository) the game runs silent.

## The bundles

Each clip is made mono, at 48 kHz, Opus. A steady sound (an engine rev, the squeal, the nitro's hiss, the winds, the
road noise) is made a seamless loop with a little of its own loop around each end (the game cuts one lap out of the
middle: seamless however the decoder trims), at -16 LUFS. A one-shot is brought to -16 LUFS by its loudest 0.4 s,
its peak at -1 dBFS at most (the crashes to -12 LUFS). `npm run build` copies the bundles into `dist/` with the rest
of `public/`.

# Engines

Each vehicle's engine is a set of steady-rev loops (`engineCatalog.ts`): the rpm each was recorded at, measured from
its harmonics, every neighbouring pair checked by matching their spectra. `engineMix.ts` lays the car's
idle..redline onto the set's own range (its lowest clip at its own speed at the idle, its highest at its own speed at
the redline), plays each clip at rpm / its rpm, and crossfades neighbours (equal power) across a narrow band around
their rpms' geometric mean. Nothing else: one car, one microphone, its clips matched.

| Vehicle | Engine | Clips |
|---|---|---|
| Supercar | V10 | 7 |
| Muscle car | V8 | 8 |
| JDM | inline four | 7 |
| Traffic sedan | inline four | 7 |
| Container truck's cab | diesel six | 8 |
| Truck | diesel six, x1.2 throughout | 8 |

## Hearing them (after grok-aircraft2)

- **The player's own engine is never placed**: straight into the mix, whichever way the camera looks (looking
  back included). Every sound of the player's car is recorded from outside (the camera is behind it).
- **The others' are**: the nearest 8 within 220 m (rivals and traffic, both directions), each panned from the
  camera by hand (`pan.ts`: azimuth, equal-power left/right, inverse distance, full within 10 m) into two gain
  nodes - no `PannerNode`, which recomputes every sample once anything moves (grok-aircraft2 measured it at
  several times the audio thread's load, heard as crackling). A voice comes in over 0.1 s, and goes over 0.4 s.
- **Doppler**: each one's rate times `(c + ear's speed toward it) / (c - its speed toward the ear)`; the ear's
  velocity from the camera's own motion (`earMotion.ts`: smoothed, a jump over 400 m/s taken as a cut).
- **Time**: every engine's rate times the race's time scale (the finish's slow motion pitches them down).
- **Out**: the mix at -6 dB (headroom), then a lookahead limiter (`limiter.worklet.js`, its math in `limiter.ts`:
  5 ms lookahead, -1.5 dBFS ceiling), bypassed if it can't load or fails; after a pause everything fades back in
  over 0.8 s, the limiter's buffer cleared first. Its input is always stereo (channelCount 2, explicit): with only
  mono sounds playing (a click, the countdown, the start-up) the mix came in mono and it put it out on the left alone.

## The rev limiter and the start-up

- **On the limiter** (at 98.8 % of the redline or more, the throttle past half), the set's limiter clip plays in the
  revs' place: its top rev with the fuel cut stuttering it about 12 times a second. Off the throttle, or the rpm
  down, the revs come back. Where an engine's own limiter recording won't do (the muscle car's a ragged burble, the
  JDM's a smeared roar), its limiter is built from its top rev, the cut put on it (`stutter` in the catalog: 12 a
  second).
- **Starting a race**, the player's car's `startup` plays once, unplaced - a system sound (below: the menus' own
  context, nothing of the race's touches it) - and its idle on from 0.05 s before its end, faded away over 1.2 s (a
  start-up hands over to the idle: the muscle car's stops dead at 0.64 s, still loud). The sound is woken (and its
  clips start loading) at the first click or key in the garage, so they're in by then.
- **The gauge on the limiter** bounces (700 rpm - about three of its blocks, to be seen - 6 times a second: a quick
  drop, a climb back - `handling.limiterBounce`); the gauge's only - the sound stutters by its limiter clip.

# Crashes

14 single hits (`crashes.bin`), each from 10 ms before its hit, at most 1.15 s, its end faded. In the game
(`Sound.crash`) each hit plays two at random, layered (after grok-aircraft2's explosions): the first (never the same
one twice running), and a different one under it, 6 dB down and 0-30 ms later - one fuller hit, not two. Their pitch
±4 % off and with the race's time; together as loud as the hit was hard: the closing speed / 30 m/s (at most 1, never
under 0.15), times -4 dB. Every touch of the player's is heard - a rival, the traffic, a guardrail; a scrape as much
as a hit, only quieter (its closing speed along the push: a side swipe little). The same thing touched again within
0.3 s isn't heard again (a scrape touching on and off).

# Tyre squeal and nitro

- **The squeal**: a skid loop from outside (9.5 s; built with the engines as a loop, `skid`), on this game's own
  slip - the player's strongest sliding tyre's slip speed: from 1.5 m/s, full at 11.5 m/s (0.6), following it within
  ~0.04 s; pitched with the race's time.
- **The rivals' squeal**: the same loop (one each, from its own random point), on each one's own slip as the
  player's (from 1.5 m/s, full at 11.5, 0.6), placed from the camera as the engines are (panned, full within 10 m,
  inversely with distance beyond; none past 220 m).
- **The nitro** (`effects.bin`): as the player's lights, its start (once, 0.1325); while it burns, the hiss (0.125),
  in over ~0.3 s and out over ~0.6 s.

## The backfire's pops

Short muffler crackles (10, from outside) cut into single pops, built with the engines into `engines.bin` (`pop-1`,
`pop-2`, ... - `engineCatalog.ts`; 61 of them). Each crackle brought whole to -16 LUFS (its loudest 0.4 s), so its
pops keep their levels; a pop starts where the sound jumps (over 10 dB in 2 ms), runs to the next jump at least 60 ms
on (the pops come every 25-50 ms: a short run, as long as a flame shows), 150 ms at most, its ends faded. One much
quieter than its crackle's loudest, or cut short by its end, left out.

Each backfire flame (`vehicles/backfire.ts`: 1-3 a lift-off) pops as it lights - none on nitro, its flame not shown.
One at random (never the same twice running), pitch ±3 % and with the race's time. The player's: unplaced, 0.7. A
rival's: placed from the camera as the engines are (panned, full within 10 m, inversely with distance beyond; none
past 220 m), 0.8.

## The near miss

A rush of air: six winds (steady loops, from outside), 0.8 s from the middle of each built with the engines into
`engines.bin` (`wind-1` ... `wind-6`), each at -16 LUFS (integrated). As a near miss is counted, one at random (never
the same twice running) swells in over 0.12 s to 0.9 and dies away (time constant 0.15 s), its pitch falling from
1.15 to 0.85 over 0.5 s (the car going by); panned from where that car is (from the camera; close by, so at full),
all with the race's time. Nothing at the finish.

# Tyres rolling

A car's road noise at 97 km/h (`effects.bin`'s `roll`): its steadiest 8 s (the 20 ms blocks' loudness varying least:
no bumps; not its first or last second), a seamless loop, at -16 LUFS.

The traffic plays it (`src/audio/rolling.ts`), by its speed over the road: its rate the speed over the recording's
(0.35-2.2), its level (speed / 97 km/h)^1.5 - about +9 dB each doubling, at most 3x - faded in under 3 m/s, none
standing. A car 0.8; a truck 0.8 at a 0.8 pitch; a container truck twice, its cab (0.8, 0.8) and its trailer from
its rear axles (0.8, 0.75) - a car heard by its tyres, a truck by its diesel (its engine 1.1, a container's 1.25:
measured at 10 m, a car's tyres ~6 LU over its engine at 110 km/h, a truck's engine 2-5 LU over its tyres). Wrecks
none. The nearest 8 within 150 m, each its own loop (from a random point), placed from the camera as the engines are
(panned, full within 8 m, inversely with distance beyond, Doppler-shifted), 0.6 on top.

Not the player's nor the rivals': their engines are loud enough (tried, and taken out).

# The wind

The wind past the player's car: a wind recording whole (6 s, a steady loop), built with the engines into
`engines.bin` as `wind-loop`. Unplaced, as the engine (`src/audio/wind.ts`): 0.3 at 200 km/h, its level
(speed / 200 km/h)^2 - about +12 dB each doubling, next to nothing at a crawl, at most 2x (~280 km/h) - its rate
1 + 0.3 per 200 km/h away from it (0.75-1.3); pitched with the race's time.

The rivals' wind: the same loop by the same law of their speed, heard only close by - the nearest 5 within 40 m, each
its own loop (from a random point), placed from the camera as the traffic's tyres are (`src/audio/placedLoops.ts`:
panned, full within 5 m, inversely with distance beyond, Doppler-shifted: a rush going by), 0.3 on top.

# Background music

`src/audio/music.ts`: songs in `public/audio/music/`, listed in its `playlist.json` - file names (`["a.mp3", ...]`)
or `{ "file": "a.mp3", "title": "Night Drive" }` (the title shown; without one, the file's name). They live only in
the private repository, copied in for the build by the Pages workflow. No playlist: no music, nothing else changes.

- Starts at the first click or key (the browser lets nothing play before), in the garage; plays through the races.
- A shuffled order, round and round; **M** mutes it with the rest.
- Every change of scene (a race starting - from the garage, again, restarted - back to the garage; not the finish)
  moves on to the next song: this one faded out over 1 s, 2 s of quiet, the next faded in over 1.5 s
  (`SCENE_SWITCH`). **N** the same in under half a second, no quiet (`SKIP_SWITCH`: switched there and then, a
  song would click).
- `MUSIC_VOLUME` (0.22, the `<audio>` element's volume) as a rule: the songs (about -14 LUFS) about 4 dB under the
  player's engine (its clips -16 LUFS through ENGINE_VOLUME 0.8 and MASTER 0.5: about -24 LUFS). `MUSIC_COUNTDOWN`
  (40 % of it) in the countdown, eased over 0.15 s each way (0.4: back up too slowly after it).
- The player's volumes (`src/audio/volumes.ts`, the settings pop-up's two rows): the music's and the sound's (all
  the rest, on the master), each Mute or 10-100 %, full as it comes; heard as they are picked, put back on cancel,
  kept on OK. **M** mutes both (kept too).
- Past the finish line (its slow motion) the sound fades away over 2.5 s (`Sound.fadeAway`): slowed down it sounds
  wrong. The music plays on (the same song), down to half (`MUSIC_FINISH`) over the same 2.5 s. Back at once for the
  next race or the garage, behind the black between them.
- Its own `<audio>` element, streamed, outside the Web Audio graph. Stopped where it is in a pause, and in a hidden
  tab; on from there after, faded in from silence (as the sound after a pause).
- Its title and how far into it / how long it is (`src/ui/nowPlaying.ts`): in the race under the place (in the HUD,
  shaking with it), in the garage under the controls / settings buttons; the title sliding across and back when too
  long for its box.

# The countdown, the finish and the menus

- **The countdown** (3, 2, 1) and its green, the finish line: a bass drum impact (`impact`, a 5.6 s tail), its
  loudest 0.05 s in (`IMPACT_PEAK`): played that far ahead of each number and of the green (the 3 from there: no time
  ahead of it), so it peaks as the number shows. 3, 2, 1 at 3, faded away over 1 s (their tails piled up a beat a
  second); the green at 4, at 0.7 of its speed (deeper), rung out; the finish at 2.5, as recorded, from its loudest.
  On the cues' bus: the player's volume, but not the race's (the finish's fade-away leaves it).
- **The menus' click** (`click`, 0.16 s) at 0.25 - a button or anything with its own click handler (mouse, or the
  Enter on a focused button: one listener on the UI root), and the menus' keys (the garage's arrows, its pop-ups, the
  tuning, the race setup, the settings, the pause and finish menus, Esc in and out of the pause). A **system sound**:
  on its own AudioContext (`uiCtx`, the player's volume and mute, no limiter), so heard with the race's stopped in a
  pause.
