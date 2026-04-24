---
name: clawcraft-bot
description: Safely control a local Minecraft bot via HTTP API. Always act slowly and verify every step: health -> status -> danger check -> one action -> poll job -> recheck. Prioritize survival, defense, food, tools, and early-game progression.
metadata: { "openclaw": { "emoji": "⛏️", "requires": { "bins": ["node", "curl"] }, "os": ["win32", "linux", "darwin"] } }
---

# ClawCraft Bot — Safe Minecraft Survival Skill

Controls a local Mineflayer-based Minecraft bot through a REST API at **http://127.0.0.1:3001**.

This skill is designed for **weak and strong models alike**.
The bot must behave like a **careful survival player**, not like an improvising speedrunner.

The goal is not just to use the API.
The goal is to **survive, make steady progress, and avoid command spam or unsafe behavior**.

---

# LAYER 1 — CORE RULES

## Core Identity

You are controlling a Minecraft bot in a survival-like environment.
You must behave in a **slow, cautious, verified, one-step-at-a-time** way.

Your default style is:
- survive first
- act in small steps
- wait for the server
- verify every result
- interrupt work if danger appears

Do not rush.
Do not queue many actions.
Do not assume success before the job result confirms it.

---

## Priority Order

Always follow this priority:

1. stay alive
2. stop immediate danger
3. restore food / recover
4. keep a usable weapon and tools
5. gather basic resources
6. upgrade from wood to stone
7. prepare for hostile conditions
8. only then do longer tasks

If survival and progress conflict, survival always wins.

---

## Mandatory Action Loop

For almost every task, use this exact loop:

1. `GET /health`
2. short pause
3. `GET /status`
4. short pause
5. if needed, `GET /inventory`
6. if danger may exist, `GET /nearby`
7. choose exactly **one** next action
8. send exactly **one** POST action
9. wait before polling
10. poll `GET /jobs/<jobId>` until terminal state
11. short pause
12. re-check `GET /status`
13. if inventory may have changed, re-check `GET /inventory`

Never skip the verification after an action.

---

## Job Polling — Exact Rules

Every POST action responds with a `jobId`. The initial HTTP 200 response only means the action was **accepted into the queue**, NOT that it succeeded.

The real outcome is always in the job status. Poll until a terminal state:

```
GET /jobs/<jobId>
```

Terminal states:
- `done` — action completed successfully, check `result`
- `failed` — action failed, check `error` message
- `cancelled` — action was cancelled by a stop command

Non-terminal (keep polling):
- `pending` — waiting in queue
- `running` — currently executing

Polling example loop (pseudo-code):
```
Repeat:
  wait 1.0 second
  GET /jobs/<jobId>
  if status == "done" or "failed" or "cancelled" → stop
  otherwise → keep polling
Max attempts: 30 (for long tasks), 5 (for fast tasks like chat/equip)
```

Fast actions (chat, equip, hotbar, toss): typically done within **1 poll attempt**.
Slow actions (goto, collect, dig, craft): may need **10–30 seconds** of polling.

---

## Timing Rules

The server and bot need time to react.

Use these pacing rules:

- between simple GET requests: wait about **0.3 to 0.7 seconds**
- after starting any POST action: wait about **1.0 second** before first poll
- while polling a job: poll every **1.0 to 1.5 seconds**
- after a job finishes: wait about **0.5 to 1.0 seconds** before next action
- after `stop`, `consume`, or `respawn`: wait about **1.0 to 2.0 seconds** before re-checking state

Never send multiple POST actions back-to-back while a previous action is still active.

---

## Hard Safety Rules

1. **Always check `/health` first** before doing anything important.
2. **Always check `/status`** before deciding a plan.
3. **Only one action runs at a time.**
4. **HTTP 200 on a POST means the action was queued, NOT that it succeeded. Always poll the job.**
5. **If the bot is under attack, stop the normal plan and defend first.**
6. **Do not mine, craft, or wander while under active threat.**
7. **Do not assume inventory changed until inventory is checked.**
8. **Do not retry blindly after failure. Inspect first.**
9. **Do not invent endpoints.**
10. **Do not expose the API. It is local-only by design.**
11. **Two types of errors exist:**
    - **Immediate errors (HTTP 400/404):** returned directly, no `jobId` created. Check `error` field.
    - **Job-level errors:** job returns HTTP 200 with `jobId`, but job `status` is `failed`. Always poll to find out.
12. **Before `consume`, always `equip` a food item into `hand` first.** `consume` fails with `"Bot is not holding any item"` if the hand is empty.

---

## Danger Rule

Treat the situation as dangerous if any of the following is true:

- health is low
- food is low
- a hostile mob is nearby
- the user says the bot is being attacked
- status suggests damage, danger, or instability
- it is night and the bot is outside and vulnerable
- a combat or movement job just failed in a dangerous area

When danger exists, pause the normal plan and switch to the relevant defense playbook.

---

## Small-Step Rule

Always prefer:
- one nearby block instead of many far blocks
- one craft step instead of a whole chain
- one target at a time in combat
- one short movement instead of long travel
- one verification after each step

Bad behavior:
- sending many actions quickly
- assuming the world already updated
- crafting without checking ingredients
- collecting while being attacked
- continuing after a failed job without inspecting state

---

## Default Early-Game Goal

If the user gives no special long-term objective, use this progression:

- stabilize
- get wood
- craft basics
- get stone
- craft stone tools
- secure food
- stay combat-ready
- avoid risky expansion

The bot should play conservatively.

---

# LAYER 2 — PLAYBOOKS

## PLAYBOOK A — Session Start

Use this at the beginning of a session or after uncertainty.

### Goal
Understand the current state before acting.

### Steps
1. `GET /health`
2. wait
3. `GET /status`
4. wait
5. `GET /inventory`
6. if danger is possible, `GET /nearby?radius=16`
7. decide whether the bot should:
   - defend
   - eat
   - continue progression
   - recover from failure
   - respawn

### Safe example
```bash
curl http://127.0.0.1:3001/health
sleep 0.5
curl http://127.0.0.1:3001/status
sleep 0.5
curl http://127.0.0.1:3001/inventory
sleep 0.5
curl "http://127.0.0.1:3001/nearby?radius=16"
```

If the service is not running, start it with:
```bash
cd {baseDir}/.. && npm start
```

After starting, wait briefly and check `/health` again before anything else.

---

## PLAYBOOK B — Under Attack / Immediate Danger

Use this whenever the bot is attacked or a hostile nearby is an immediate threat.

### Goal
Stop unsafe activity and survive.

### Steps
1. `POST /actions/stop`
2. wait
3. `GET /status`
4. `GET /inventory`
5. `GET /nearby?radius=12`
6. equip the best available weapon
7. attack the most relevant hostile, preferably by `id`
8. poll job to completion
9. re-check `/status`
10. if needed, re-check `/inventory`
11. only resume normal work when safe

### Weapon preference
Prefer roughly this order:
- `diamond_sword`
- `iron_sword`
- `stone_sword`
- `wooden_sword`
- `diamond_axe`
- `iron_axe`
- `stone_axe`
- `wooden_axe`
- best available pickaxe as last resort

### Combat rules
- prefer attacking by `id` if `/nearby` gives a precise target
- do not chase distant threats unnecessarily
- if health is poor, avoid optional fights
- if food is low and eating is possible safely, recover before resuming work
- do not return to mining or crafting immediately after combat without checking status

### Safe example
```bash
curl -X POST http://127.0.0.1:3001/actions/stop -H "Content-Type: application/json" -d '{}'
sleep 1.0
curl http://127.0.0.1:3001/status
sleep 0.5
curl http://127.0.0.1:3001/inventory
sleep 0.5
curl "http://127.0.0.1:3001/nearby?radius=12"
```

Then equip best weapon if available:
```bash
curl -X POST http://127.0.0.1:3001/actions/equip -H "Content-Type: application/json" -d '{"name":"stone_sword","destination":"hand"}'
```

Then poll the job. After that, attack a precise target:
```bash
curl -X POST http://127.0.0.1:3001/actions/attack -H "Content-Type: application/json" -d '{"id":12345}'
```

Poll again until done, then re-check status.

---

## PLAYBOOK C — Early-Game Progression

Use this as the default survival plan when there is no urgent danger.

### Goal
Make reliable early progress without overcommitting.

### Phase 1 — Stabilize
Before progressing, confirm:
- the bot is alive
- no immediate threat exists
- health and food are acceptable
- inventory has room

If food is low, switch to the food playbook.

### Phase 2 — Get Wood
First important resource is wood.

Preferred target:
- nearby logs such as `oak_log`

Gather in small amounts.
Do not request huge counts.
A safe early target is roughly **3 to 6 logs total**, not a giant farm session.

Use:
- `GET /findblock?name=oak_log`
- then `POST /actions/dig` or `POST /actions/collect`

### Phase 3 — Craft Basics
After wood, progress in small craft steps:
- planks
- sticks
- crafting table if needed
- wooden pickaxe if no better pickaxe exists

Do not try a whole craft chain blindly.
Craft one step, verify inventory, then continue.

### Phase 4 — Upgrade to Stone
As soon as possible:
- obtain cobblestone
- craft `stone_pickaxe`
- craft `stone_axe`
- craft `stone_sword`

Stone tier is a major survivability improvement.
Do not remain on wooden tools for long if stone is available.

### Phase 5 — Basic Combat Readiness
Before doing longer work:
- ensure at least one decent weapon exists
- ensure food is not critically low
- avoid wandering far without reason

### Phase 6 — Conservative Continuation
If the user does not specify a new goal:
- keep gathering safely
- improve tools
- avoid unnecessary danger
- do not travel far just because it seems possible

---

## PLAYBOOK D — Wood Gathering

Use this when wood is the next bottleneck.

### Goal
Get a small amount of nearby logs safely.

### Steps
1. `GET /health`
2. `GET /status`
3. `GET /findblock?name=oak_log`
4. if the target exists and the area is safe, dig or collect one nearby log
5. poll job
6. re-check `/inventory`
7. repeat only if still needed

### Safe example
```bash
curl http://127.0.0.1:3001/health
sleep 0.5
curl http://127.0.0.1:3001/status
sleep 0.5
curl "http://127.0.0.1:3001/findblock?name=oak_log"
sleep 0.5
curl -X POST http://127.0.0.1:3001/actions/dig -H "Content-Type: application/json" -d '{"name":"oak_log"}'
```

Read `jobId`, wait, then poll:
```bash
curl http://127.0.0.1:3001/jobs/<jobId>
```

After completion:
```bash
curl http://127.0.0.1:3001/inventory
curl http://127.0.0.1:3001/status
```

---

## PLAYBOOK E — Crafting and Tool Upgrades

Use this when materials appear sufficient and the bot is safe.

### Goal
Craft items in short, verified steps.

### Rules
- inspect inventory before crafting
- craft one intermediate item at a time
- re-check inventory after each step
- if crafting fails, do not retry immediately without checking ingredients

### Good crafting sequence
1. check `/inventory`
2. craft planks if needed
3. poll job
4. check `/inventory`
5. craft sticks if needed
6. poll job
7. check `/inventory`
8. craft target tool
9. poll job
10. check `/inventory`

### Useful early items
Common early names may include:
- `oak_log`
- `oak_planks`
- `stick`
- `crafting_table`
- `wooden_pickaxe`
- `stone_pickaxe`
- `stone_axe`
- `stone_sword`

Use the exact item names expected by the server.

### Example
```bash
curl http://127.0.0.1:3001/inventory
sleep 0.5
curl -X POST http://127.0.0.1:3001/actions/craft -H "Content-Type: application/json" -d '{"name":"stick","count":4,"useCraftingTable":false}'
```

Poll the job, then re-check inventory before the next craft step.

---

## PLAYBOOK F — Food Recovery

Use this when food is low or the bot should recover before risk.

### Goal
Reduce starvation risk and restore safer status.

### CRITICAL: consume requires item in hand

`consume` will ALWAYS fail with `"Bot is not holding any item"` if the hand is empty.

You MUST equip a food item into `hand` BEFORE calling consume:
1. Check inventory for a food item (e.g. `bread`, `cooked_beef`, `apple`, `cooked_chicken`)
2. `POST /actions/equip {"name": "bread", "destination": "hand"}`
3. Poll equip job to `done`
4. THEN `POST /actions/consume {}`
5. Poll consume job

Skipping the equip step will waste a job and a polling cycle.

### Steps
1. `GET /status`
2. `GET /inventory` — find what food is available
3. if edible items exist and the area is safe:
   - `POST /actions/equip {"name": "<food_item>", "destination": "hand"}`
   - poll equip job to `done`
   - `POST /actions/consume {}`
   - poll consume job
4. re-check `/status`

### Rules
- do not eat in the middle of active combat unless it is the only safe recovery route
- do not start a long gather/craft chain while food is dangerously low
- if food is low and no food exists, act conservatively and avoid risky movement

### Example
```bash
curl http://127.0.0.1:3001/inventory
sleep 0.5
curl -X POST http://127.0.0.1:3001/actions/equip -H "Content-Type: application/json" -d '{"name":"bread","destination":"hand"}'
```

Poll equip job. Then:
```bash
curl -X POST http://127.0.0.1:3001/actions/consume -H "Content-Type: application/json" -d '{}'
```

Poll consume job, then re-check `/status`.

---

## PLAYBOOK G — Night / Unsafe Conditions

Use this when the environment becomes more dangerous, especially at night.

### Goal
Avoid unnecessary exposure and keep the bot ready.

### Rules
- do not begin long travel
- do not start ambitious gathering runs
- do not ignore nearby hostiles
- keep combat readiness high
- prefer short, local, low-risk actions

### Preferred behavior
If it is night and the bot is exposed:
- stop optional plans
- inspect nearby threats
- keep weapon ready
- avoid wandering
- focus on surviving until conditions improve

This skill should play cautiously unless the user explicitly wants aggressive play.

---

## PLAYBOOK H — Death and Respawn

Use this when the bot dies or is clearly in a dead/down state.

### Goal
Recover cleanly and avoid instantly repeating mistakes.

### Steps
1. `POST /actions/respawn`
2. wait longer than usual
3. `GET /health`
4. `GET /status`
5. `GET /inventory`
6. if danger may still exist, `GET /nearby`
7. do not instantly resume the old task without re-evaluating safety

### Rules
- after respawn, assume the previous plan may no longer be valid
- equipment or position may be different
- if inventory is damaged or empty, return to conservative survival logic

### Example
```bash
curl -X POST http://127.0.0.1:3001/actions/respawn -H "Content-Type: application/json" -d '{}'
sleep 2.0
curl http://127.0.0.1:3001/health
sleep 0.5
curl http://127.0.0.1:3001/status
sleep 0.5
curl http://127.0.0.1:3001/inventory
```

---

## PLAYBOOK I — Movement and Positioning

Use this when the next target is not directly reachable without moving.

### Goal
Move carefully without movement spam.

### Rules
- prefer short movement over long travel
- never issue repeated `goto` calls quickly
- after movement, verify position or status
- if movement fails, inspect state before trying again

### Example
```bash
curl http://127.0.0.1:3001/status
sleep 0.5
curl -X POST http://127.0.0.1:3001/actions/goto -H "Content-Type: application/json" -d '{"x":100,"y":64,"z":-200}'
```

Then wait, poll the job, and verify:
```bash
curl http://127.0.0.1:3001/position
curl http://127.0.0.1:3001/status
```

---

## PLAYBOOK J — Failure Recovery

Use this when any action returns a failed or cancelled job.

### Goal
Recover by reducing complexity, not by brute-force retrying.

### Steps
1. slow down
2. `GET /status`
3. if items matter, `GET /inventory`
4. if world target matters, `GET /nearby` and/or `GET /scan-blocks` and/or `GET /findblock`
5. retry only with a smaller, safer, or more precise action

### Failure patterns
If `collect` fails:
- reduce count
- inspect nearby blocks
- try a closer or simpler target

If `dig` fails:
- confirm the target block exists first
- use a precise coordinate if available

If `craft` fails:
- inspect ingredients
- verify item names
- craft intermediate items first

If `equip` fails:
- confirm the item is actually present in inventory

If `attack` fails:
- refresh nearby entities
- prefer target `id` over broad name
- make sure combat is still relevant

If `goto` fails:
- inspect current position and nearby danger
- avoid immediate repeated movement spam

### Rule
If multiple failures happen in a row, switch to a safer fallback plan instead of forcing the same action repeatedly.

---

# ENDPOINTS

## Read-Only Endpoints

```text
GET /health                          → uptime, botState, queue
GET /status                          → health, food, position, gameMode, time
GET /position                        → x, y, z, yaw, pitch
GET /inventory                       → items[], freeSlots, equipment
GET /nearby?radius=32                → entities[], sorted by distance
GET /scan-blocks?radius=8            → nearest interesting blocks
GET /findblock?name=oak_log          → nearest block(s) of type
GET /jobs/<jobId>                    → pending|running|done|failed|cancelled
GET /                                → list of all endpoints
```

### Notes on read-only responses

**`/nearby` — player health is always `null`.**
Minecraft does not expose other players' health to the bot. The `health` field for `type: "player"` entities will always be `null`. Do not use it to assess player safety.

**`/status` — interpreting time of day:**
- `timeOfDay` 0–12000 = daytime (safe to work outside)
- `timeOfDay` 12000–13000 = sunset (prepare for night)
- `timeOfDay` 13000–23000 = night (hostile mobs spawn, increased danger)
- `timeOfDay` 23000–24000 = sunrise (getting safer)

**`/findblock` — errors return immediately (HTTP 400), not as a job:**
If the block name is invalid (e.g. `INVALID_BLOCK`), the response is `{"ok": false, "error": "Unknown block: ..."}` with no `jobId`. Always use exact Minecraft block names.

## Action Endpoints

### Navigation
```json
POST /actions/goto   {"x": 100, "y": 64, "z": -200}
POST /actions/follow {"player": "Steve", "distance": 3}
POST /actions/stop   {}
```

### Chat
```json
POST /actions/chat    {"message": "Hello everyone!"}
POST /actions/whisper {"player": "Steve", "message": "Hi!"}
```

Use chat sparingly. Do not spam public chat.

### Combat
```json
POST /actions/attack  {"name": "zombie"}
POST /actions/attack  {"id": 12345}
POST /actions/protect {"player": "Steve"}
```

Prefer `id` when a precise nearby target is known.

### World Interaction
```json
POST /actions/collect        {"name": "oak_log", "count": 6, "maxDistance": 32}
POST /actions/dig            {"name": "oak_log"}
POST /actions/dig            {"x": 100, "y": 64, "z": -200}
POST /actions/activate-block {"x": 100, "y": 64, "z": -200}
POST /actions/place-block    {"x": 100, "y": 64, "z": -200, "name": "dirt"}
```

### Item Management
```json
POST /actions/equip    {"name": "diamond_sword", "destination": "hand"}
POST /actions/unequip  {"destination": "hand"}
POST /actions/craft    {"name": "stick", "count": 4, "useCraftingTable": false}
POST /actions/consume  {}
POST /actions/toss     {"name": "dirt", "count": 10}
POST /actions/hotbar   {"slot": 0}
POST /actions/respawn  {}
POST /actions/creative {"name": "diamond", "count": 64, "slot": 36}
```

`creative` should only be used if the user explicitly wants creative-mode behavior or the environment clearly allows it.

---

# RESPONSE FORMAT

All responses:
```json
{ "ok": true/false, "data": {...}, "error": "..." }
```

Action response:
```json
{ "ok": true, "data": { "jobId": "uuid", "action": "...", "params": {...} } }
```

Job status:
```json
{ "ok": true, "data": { "id": "...", "status": "done", "result": {...}, "error": null } }
```

Important rule:
The initial POST response only confirms that the action was accepted.
The real outcome is the job result.

---

# COMMON ERRORS AND WHAT THEY MEAN

These are real error messages returned by the API. Use them to decide the next action.

| Error message | Cause | Fix |
|---|---|---|
| `"Bot is not holding any item"` | Called `consume` with empty hand | `equip` a food item into `hand` first, then retry `consume` |
| `"Item \"X\" not found in inventory"` | Tried to equip/use an item not in inventory | Check `/inventory`, get the item first |
| `"No path found to target"` | Pathfinder cannot reach the destination | Try a closer coordinate, check for obstacles |
| `"Action goto timed out (30s)"` | Navigation took too long | Target may be unreachable; try `/actions/stop`, then shorter route |
| `"Unknown block: \"X\""` | Invalid block name | Use exact Minecraft block names (e.g. `oak_log`, not `log`) |
| `"Block \"X\" not found within N blocks"` | No such block nearby | Try larger radius or different area |
| `"Cannot dig block \"X\" (out of range or not diggable)"` | Block too far or unbreakable | Move closer first, or choose a different block |
| `"Player \"X\" not found or not visible"` | Target player not in render range | Cannot follow/protect; player is too far or offline |
| `"Bot not connected or not spawned yet"` | Bot is still connecting (HTTP 503) | Wait and retry `/health` until `spawned: true` |
| `"No crafting table found within 32 blocks"` | `useCraftingTable: true` but no table nearby | Place a crafting table first, or craft without one if recipe allows |
| `"You don't have enough materials to craft \"X\""` | Missing ingredients | Check `/inventory`, gather missing materials first |

**Rule:** If the error is not in this list, read it carefully and do the simplest corrective action. Do not guess. Do not retry the same action without fixing the root cause.

---

# SIMPLE DEFAULT DECISIONS

When unsure, choose the simplest safe next step:

- no wood yet → get wood
- no pickaxe → craft a pickaxe
- wooden tools only → upgrade to stone
- low food → recover food first
- under attack → stop and defend
- night and unsafe → avoid risky plans
- inventory full → free low-value space before more gathering
- repeated failures → switch to safer fallback behavior

When in doubt, pick the smaller and safer action.

---

# BEHAVIOR STYLE

The bot must be calm, slow, methodical, and survival-first.

Good behavior:
- checks state often
- acts in small steps
- verifies every outcome
- interrupts work to survive
- resumes only after re-checking safety

Bad behavior:
- long action chains
- POST spam
- blind retries
- guessing inventory contents
- mining during combat
- assuming the server already updated

This skill should make even a weaker model act safely and predictably.