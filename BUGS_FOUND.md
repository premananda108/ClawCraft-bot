# Bugs and Issues Found - ClawCraft-bot

This document records the technical issues and bugs identified during the autonomous survival and protection testing.

## 1. NaN Coordinate Corruption (Fixed)
- **Symptom:** Bot coordinates (`bot.entity.position`) become `NaN` (Not-a-Number) after an explosion (e.g., creeper) or heavy knockback.
- **Cause:** Division by zero or invalid calculations in the physics engine when processing explosion packets.
- **Resolution:** Added a `physicTick` listener in `src/bot-core.js` that tracks the last valid position and restores it if `NaN` is detected, while zeroing out velocity.

## 2. Incomplete Entity Filtering (Fixed)
- **Symptom:** The bot ignored zombies and skeletons during protection jobs.
- **Cause:** Modern `mineflayer` versions categorize aggressive monsters as `type: 'hostile'` rather than `type: 'mob'`. The code was filtering strictly for `'mob'`.
- **Resolution:** Updated `findHostileNear` in `src/actions/combat.js` and the monitor in `test-protect.js` to accept both `'mob'` and `'hostile'` types.

## 3. Unreachable Crafting Table Timeout
- **Symptom:** `craftItem` fails with `windowOpen did not fire within timeout`.
- **Cause:** The `findBlock` logic in `src/actions/items.js` finds the nearest crafting table within 32 blocks. If that table is on a different vertical level (e.g., on top of a mountain) and the pathfinder cannot reach it, the bot eventually times out trying to open it from too far away.
- **Recommendation:** Implement a pathfindable check or prefer blocks on the same Y-level before attempting interaction.

## 4. Suffocation on Block Placement
- **Symptom:** Bot's `oxygen` level drops rapidly after placing a block.
- **Cause:** The bot can successfully place a block (like a crafting table) at its own current coordinates. This causes the bot's head to be "inside" the block, triggering suffocation logic.
- **Recommendation:** Add a check to prevent placing blocks at the bot's exact `Math.floor` coordinates or auto-move the bot after placement.

## 5. Network Packet Fragmentation (Intermittent)
- **Symptom:** Server logs show `Chunk size is X but only Y was read ; partial packet`.
- **Cause:** Likely due to high latency or issues with the `minecraft-protocol` library handling fragmented TCP packets in the local environment.
- **Status:** Observed but did not cause a fatal crash during this session.

## 6. Combat Detection Verticality
- **Symptom:** Bot "stares" at walls/floor instead of following the player.
- **Cause:** The bot detected hostile mobs in caves deep below the surface and prioritizes them as targets, even if unreachable.
- **Resolution:** Restricted `findHostileNear` to ignore mobs with a vertical difference greater than 5 blocks.
