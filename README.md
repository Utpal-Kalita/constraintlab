# ConstraintLab

Declare musical rules. Watch a constraint solver find a piece that obeys every switched-on rule - and show its work.

**Live demo:** https://utpal-kalita.github.io/constraintlab/

## What it does

1. You declare constraints: key, mode, and a set of hard voice-leading rules (no parallel fifths/octaves, no voice crossing, leading-tone resolution, maximum leaps, cadence requirements).
2. A backtracking constraint solver searches for (a) an 8-chord progression and (b) a four-voice (SATB) voicing that satisfy every switched-on rule, across a 16-bar AABA form. The A phrases end on the tonic; when the penultimate rule is switched on, a dominant-function chord (V or vii deg) precedes each final tonic. The B phrase ends on a dominant-function chord (V or vii deg). Note: the solver accepts vii deg as a dominant-function chord, so these are not necessarily V-I 'authentic cadences' in the strict sense - the UI says exactly what is enforced.
3. The **proof panel** shows every rule enforced and how many candidate answers were rejected - the search is inspectable, not a black box.
4. The piece plays in the browser (Web Audio) and exports to WAV. Everything runs client-side; no account, no server, no network calls.

## Determinism

Same seed + same constraints = same piece, always. Share links encode only constraints and the seed, so a link reproduces the exact piece for anyone.

## Honest scope and limits

- Constraint programming for music composition is an established research technique (academic systems since the 1990s). ConstraintLab is a transparent browser implementation of that mechanism.
- Current limits: root-position triads only, four voices, one 16-bar AABA form with the A phrase repeated identically, harmonic minor or major keys. The leading-tone rule applies to the soprano, within each phrase and across the B-to-A seam; parallel fifths/octaves and the upper-voice leap limit are enforced across all phrase seams (A-A, A-B, B-A).
- It is a composition toy with a proof, not a replacement for a composer.

## Run locally

Serve the folder with any static server (`python3 -m http.server`) and open `index.html`. No build step.

## Tests

- `node test.js` - solver unit tests (determinism, rule enforcement verified by an independent checker, honest failure on unsatisfiable constraints, proof completeness).
- `node test2.js` - independent checker: derives every fact from raw MIDI pitches with a locally re-implemented scale/triad model (cadence degrees, root-in-bass, parallels, leaps, ranges, crossing, leading-tone resolution across all transitions, 40-seed sweep, switched-off-rule labeling, honest failure).
- `python3 uitest.py` - browser end-to-end tests (solve flow, UI determinism, share-link round trip, real WAV export, playback, mobile).

## Disclosure

Built with AI assistance (design and code), disclosed per hackathon rules.
