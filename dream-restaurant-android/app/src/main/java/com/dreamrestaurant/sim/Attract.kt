package com.dreamrestaurant.sim

import com.dreamrestaurant.core.Appearance
import com.dreamrestaurant.core.B
import com.dreamrestaurant.core.GameState
import com.dreamrestaurant.core.Rng
import kotlin.math.floor
import kotlin.math.pow

/** 對應 src/sim/attract.js —— 店門口路人與拉客 */

private val WALKER_TYPES = listOf("student", "office", "family", "tourist")

private val HAIRS = listOf("#2b1b12", "#4a2c14", "#7a4a1e", "#111111", "#5a5a5a", "#3a2418", "#8a5a2a")
private val SKINS = listOf("#f0c9a0", "#e8b98a", "#d9a878", "#c08a5a", "#f6d7b4")
private val SHIRTS = listOf(
    "#3a6ea5", "#b03030", "#2f7d4f", "#d9a520", "#7a4a8a", "#3f3f3f", "#d97a3a", "#4aa5a5", "#e8e0d0"
)

fun randomAppearance(rng: Rng): Appearance = Appearance(
    hair = rng.pick(HAIRS) ?: HAIRS[0],
    skin = rng.pick(SKINS) ?: SKINS[0],
    shirt = rng.pick(SHIRTS) ?: SHIRTS[0],
    hat = if (rng.chance(0.12)) rng.int(1, 3) else 0
)

fun spawnWalkers(state: GameState, rng: Rng, count: Int = 6) {
    val lane = state.layout.sidewalk ?: Sidewalk(B.GRID_H - 0.5, 0, state.layout.gridW - 1)
    while (state.sim.walkers.size < count) {
        val dir = if (rng.chance(0.5)) 1 else -1
        state.sim.walkers.add(
            com.dreamrestaurant.core.Walker(
                uid = "w${state.day}_${state.sim.walkers.size}_${floor(rng.next() * 9999).toInt()}",
                x = if (dir > 0) lane.x0.toDouble() else lane.x1.toDouble(),
                y = lane.y,
                dir = if (dir > 0) "E" else "W",
                dx = dir,
                speed = rng.range(0.35, 0.9),
                frame = 0.0,
                type = rng.pick(WALKER_TYPES) ?: WALKER_TYPES[0],
                appearance = randomAppearance(rng),
                life = rng.range(60.0, 240.0)
            )
        )
    }
}

fun updateWalkers(state: GameState, dtMin: Double, rng: Rng) {
    val lane = state.layout.sidewalk ?: Sidewalk(B.GRID_H - 0.5, 0, state.layout.gridW - 1)
    val remaining = mutableListOf<com.dreamrestaurant.core.Walker>()
    for (w in state.sim.walkers) {
        w.x += w.dx * w.speed * dtMin
        w.life -= dtMin
        w.frame = (w.frame + dtMin * 0.6) % 2
        if (w.x < lane.x0 || w.x > lane.x1 || w.life <= 0) {
            if (state.sim.walkers.size <= 2) {
                w.dx *= -1
                w.dir = if (w.dx > 0) "E" else "W"
                w.x = if (w.dx > 0) lane.x0.toDouble() else lane.x1.toDouble()
                w.life = rng.range(60.0, 240.0)
                remaining.add(w)
            }
            continue
        }
        remaining.add(w)
    }
    state.sim.walkers = remaining
    if (state.sim.walkers.size < 4) spawnWalkers(state, rng, 6)
}

/** 拉客加成：每次點擊 +0.5%，上限 +30%，半衰期 20 分鐘 */
fun lureMultiplier(state: GameState): Double =
    1 + clamp(state.sim.lureBoost, 0.0, B.LURE_MAX)

fun decayLure(state: GameState, dtMin: Double) {
    if (state.sim.lureBoost == 0.0) return
    val k = 0.5.pow(dtMin / B.LURE_HALF_LIFE_MIN)
    state.sim.lureBoost *= k
    if (state.sim.lureBoost < 0.0005) state.sim.lureBoost = 0.0
}

class LureResult(val converted: Boolean, val boost: Double)

fun clickLure(state: GameState, walkerUid: String? = null): LureResult {
    state.sim.lureBoost = clamp(state.sim.lureBoost + B.LURE_PER_CLICK, 0.0, B.LURE_MAX)
    state.sim.lureClicks += 1
    var converted = false
    if (walkerUid != null) {
        val idx = state.sim.walkers.indexOfFirst { it.uid == walkerUid }
        if (idx >= 0) {
            state.sim.walkers.removeAt(idx)
            converted = true
        }
    }
    return LureResult(converted, state.sim.lureBoost)
}
