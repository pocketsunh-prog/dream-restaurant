package com.dreamrestaurant.sim

import com.dreamrestaurant.core.B
import com.dreamrestaurant.core.GameState
import com.dreamrestaurant.core.Rng
import com.dreamrestaurant.core.WT
import com.dreamrestaurant.core.pushLog
import com.dreamrestaurant.data.EventDef
import com.dreamrestaurant.data.eventsFor
import kotlin.math.abs
import kotlin.math.floor
import com.dreamrestaurant.core.round

/** 對應 src/sim/events.js —— 突發事件（含電視採訪、竊盜等） */

/** 事件表中負面事件對評價的影響整體調弱 */
private const val NEGATIVE_REP_SCALE = 0.45

fun averageGrade(state: GameState): Double {
    val active = state.menu.filter { it.active }
    if (active.isEmpty()) return 50.0
    return active.sumOf { it.grade } / active.size.toDouble()
}

fun eventAllowed(state: GameState, eventDef: EventDef): Boolean = when (eventDef.id) {
    "food_poisoning" -> averageGrade(state) < 42
    "karen_customer" -> state.stats.today.guests >= 8
    "tv_interview" -> state.fame >= 8 || state.stats.today.guests >= 25
    "toilet_clog" -> state.layout.restroomTiles.isNotEmpty()
    else -> true
}

fun absMinute(state: GameState): Double =
    if (state.absMinute > 0) state.absMinute else (state.day * 1440 + state.minute).toDouble()

/** 每 N 遊戲分鐘擲一次事件 */
fun tickEvents(state: GameState, dtMin: Double, rng: Rng): TriggerResult? {
    val open = state.phase == "open"
    state.sim.eventTimer -= dtMin
    if (state.sim.eventTimer > 0) return null
    state.sim.eventTimer = rng.int(120, 260).toDouble()

    val pool = eventsFor(state.stars, state.locationId)
        .filter { e -> (!e.onlyWhileOpen || open) && eventAllowed(state, e) }
    if (pool.isEmpty()) return null
    val picked = rng.weighted(pool.map { WT(it, it.weight.toDouble()) }) ?: return null
    return triggerEvent(state, picked, rng)
}

fun hasMitigation(state: GameState, eventDef: EventDef): Boolean {
    val list = eventDef.mitigateBy
    if (list.isNullOrEmpty()) return false
    val owned = state.layout.items.map { it.typeId }.toSet()
    return list.any { owned.contains(it) }
}

class TriggerResult(val event: EventDef, val mitigated: Boolean, val notes: List<String>)

fun triggerEvent(state: GameState, eventDef: EventDef, rng: Rng): TriggerResult {
    val mitigated = hasMitigation(state, eventDef)
    val scale = if (mitigated) 0.22 else 1.0
    val fx = eventDef.effects
    val notes = mutableListOf<String>()

    if (fx.fame != 0) {
        val mul = if (fx.fame > 0) 1.0 else scale
        state.fame = clamp(state.fame + fx.fame * mul, 0.0, 100.0)
        val shown = round(fx.fame * mul).toInt()
        notes.add("知名度 ${if (shown > 0) "+" else ""}$shown")
    }
    if (fx.repCommunity != 0 || fx.repOutside != 0) {
        applyRep(state, "community", fx.repCommunity, scale)
        applyRep(state, "outside", fx.repOutside, scale)
        notes.add("評價變動")
    }
    if (fx.cash != 0) {
        val amount = round(fx.cash * (if (fx.cash > 0) 1.0 else scale)).toInt()
        state.cash += amount
        state.stats.today.revenue += maxOf(0, amount)
        state.stats.today.spend += maxOf(0, -amount).toDouble()
        val label = if (amount > 0) "進帳" else "損失"
        notes.add("$label NT$ ${String.format("%,d", abs(amount))}")
    }
    if (fx.moodAll != 0) {
        for (c in state.sim.customers) {
            c.mood = clamp(c.mood + fx.moodAll, -100.0, 100.0)
        }
    }
    if (fx.supplierPriceMul != 1.0) {
        state.sim.supplierPriceMul = fx.supplierPriceMul
        state.sim.supplierPriceMulUntil = absMinute(state) + 480
        notes.add("進貨價 ×${fx.supplierPriceMul}")
    }
    if (fx.trafficMul != 1.0) {
        val until = absMinute(state) + (if (fx.trafficMulMinutes > 0) fx.trafficMulMinutes else 120)
        val eff = if (fx.trafficMul > 1.0) fx.trafficMul else 1 + (fx.trafficMul - 1) * scale
        state.sim.activeEvents.add(
            com.dreamrestaurant.core.ActiveEvent(eventDef.id, eventDef.name, until, eff)
        )
        notes.add("客流 ×${"%.2f".format(eff)}")
    }
    val damage = fx.damage
    if (damage != null) {
        when {
            mitigated -> notes.add("防護設備發揮作用，損害輕微")
            damage == "ac" || damage == "stove" || damage == "fridge" -> {
                when (damage) {
                    "ac" -> state.sim.equipBroken.ac = true
                    "stove" -> state.sim.equipBroken.stove = true
                    "fridge" -> state.sim.equipBroken.fridge = true
                }
                val label = if (damage == "ac") "空調" else if (damage == "stove") "爐具" else "冰箱"
                notes.add("${label}故障")
            }
            damage == "random_item" -> {
                val candidates = state.layout.items.filter { !it.broken && it.durability > 20 }
                val target = if (candidates.isNotEmpty()) rng.pick(candidates) else null
                if (target != null) {
                    target.durability = maxOf(0, target.durability - 55)
                    if (target.durability <= 10) target.broken = true
                    notes.add("店內設備受損")
                }
            }
        }
    }
    if (fx.stockLoss != 0.0) {
        var lost = 0
        for (dishId in state.stock.keys.toList()) {
            val gone = floor((state.stock[dishId] ?: 0) * fx.stockLoss * scale).toInt()
            if (gone > 0) {
                state.stock[dishId] = (state.stock[dishId] ?: 0) - gone
                lost += gone
            }
        }
        if (lost > 0) notes.add("報廢 $lost 份食材")
    }

    val logKind = when (eventDef.kind) {
        "negative" -> "bad"
        "positive" -> "good"
        else -> "info"
    }
    val suffix = if (mitigated) "（防護有效）" else ""
    pushLog(state, "${eventDef.name}：${eventDef.log.ifEmpty { eventDef.message }}$suffix", logKind)
    state.uiQueue.add(
        com.dreamrestaurant.core.UiMsg(
            type = "event", kind = eventDef.kind, title = eventDef.name,
            message = eventDef.message, notes = notes.toMutableList()
        )
    )
    return TriggerResult(eventDef, mitigated, notes)
}

private fun applyRep(state: GameState, key: String, value: Int, scale: Double) {
    if (value == 0) return
    val base = if (value > 0) value.toDouble() else value * NEGATIVE_REP_SCALE
    val delta = base * (if (value > 0) 1.0 else scale)
    val cur = if (key == "outside") state.reputation.outside else state.reputation.community
    val next = clamp(cur + delta, B.RATING_MIN.toDouble(), B.RATING_MAX.toDouble())
    if (key == "outside") state.reputation.outside = next else state.reputation.community = next
}

/** 清理過期的事件加成 */
fun expireEvents(state: GameState): Boolean {
    val now = absMinute(state)
    val before = state.sim.activeEvents.size
    state.sim.activeEvents = state.sim.activeEvents.filter { it.until > now }.toMutableList()
    if (state.sim.supplierPriceMulUntil > 0 && state.sim.supplierPriceMulUntil <= now) {
        state.sim.supplierPriceMul = 1.0
        state.sim.supplierPriceMulUntil = 0.0
    }
    return before != state.sim.activeEvents.size
}

fun trafficMultiplierFromEvents(state: GameState): Double {
    var mul = 1.0
    for (e in state.sim.activeEvents) mul *= e.trafficMul
    return mul
}
