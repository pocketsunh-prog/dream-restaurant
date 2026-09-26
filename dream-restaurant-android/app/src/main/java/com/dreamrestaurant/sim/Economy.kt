package com.dreamrestaurant.sim

import com.dreamrestaurant.core.B
import com.dreamrestaurant.core.GameState
import com.dreamrestaurant.core.MenuEntry
import com.dreamrestaurant.core.emptyToday
import com.dreamrestaurant.core.pushLog
import com.dreamrestaurant.data.getDish
import com.dreamrestaurant.data.getLocation
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import com.dreamrestaurant.core.round

/** 對應 src/sim/economy.js —— 成本、水電、每日結算 */

fun clamp(v: Double, a: Double, b: Double): Double = min(b, max(a, v))

fun clamp(v: Int, a: Int, b: Int): Int = min(b, max(a, v))

fun round2(v: Double): Double = round(v * 100) / 100

fun avgOf(list: List<Double>): Double {
    if (list.isEmpty()) return 0.0
    var sum = 0.0
    for (v in list) sum += v
    return round(sum / list.size * 10) / 10
}

/** 單份材料成本：材料等級與份量都會推高成本 */
fun ingredientCost(entry: MenuEntry?, dishId: String? = null): Double {
    val def = if (dishId != null) getDish(dishId) else null ?: getDish(entry?.dishId)
    val base = (def?.baseCost ?: 20).toDouble()
    val grade = clamp(entry?.grade ?: 50, 0, 100).toDouble()
    val portion = clamp(entry?.portion ?: 50, 0, 100).toDouble()
    return base * (0.6 + (grade / 100.0) * 0.9) * (0.75 + portion / 150.0)
}

fun unitCost(entry: MenuEntry): Double = round(ingredientCost(entry) * 10) / 10

fun buyCost(entry: MenuEntry?, servings: Int, supplierPriceMul: Double = 1.0): Int =
    round(ingredientCost(entry) * servings * supplierPriceMul).toInt()

fun deliveryDelay(): Int = B.DELIVERY_MINUTES

/** 每日水電：空調偏離舒適帶越遠越貴，燈具與設備也要錢 */
fun dailyUtilities(state: GameState): Int {
    val weather = state.sim.weather.ifEmpty { "sunny" }
    val shift = B.WEATHER_COMFORT_SHIFT[weather] ?: 0
    val bandMin = B.COMFORT_MIN + shift
    val bandMax = B.COMFORT_MAX + shift
    val dev = if (state.sim.equipBroken.ac) {
        6.0
    } else {
        max(0.0, max(bandMin - state.settings.acTemp, state.settings.acTemp - bandMax).toDouble())
    }
    val lights = state.layout.items.count { i ->
        val id = i.typeId
        id.contains("lamp") || id.contains("light") || id.contains("chandelier")
    }
    val fridgeLvl = state.kitchen.fridge.coerceAtLeast(1)
    val fridge = if (state.sim.equipBroken.fridge) round(900 * B.kitchenFridgeMultiplier(fridgeLvl)).toInt() else 0
    return round(B.UTILITY_BASE + dev * B.UTILITY_PER_DEGREE + lights * 45 + fridge).toInt()
}

/** 生鮮隔日折損 */
fun applyPerishableLoss(state: GameState): Int {
    var lost = 0
    val lvl = state.kitchen.fridge.coerceAtLeast(1)
    val lossMul = B.kitchenFridgeMultiplier(lvl)
    val snapshot = state.stock.entries.toList()
    for ((dishId, qty) in snapshot) {
        val def = getDish(dishId) ?: continue
        if (def.category !in B.PERISHABLE_CATEGORIES) continue
        val gone = floor(qty * B.PERISHABLE_LOSS * lossMul).toInt()
        if (gone > 0) {
            state.stock[dishId] = qty - gone
            lost += gone
        }
    }
    return lost
}

/**
 * 每日打烊結算：水電、折損、統計寫入 history。
 * 薪資與租金在營業中／開店時就即時扣除，這裡只彙總。
 */
fun finalizeDay(state: GameState): com.dreamrestaurant.core.DailyRecord {
    val today = state.stats.today
    val utilities = dailyUtilities(state)
    state.cash -= utilities
    today.utilities = utilities
    today.spend += utilities

    val lost = applyPerishableLoss(state)
    if (lost > 0) pushLog(state, "生鮮折損 $lost 份", "warn")

    state.suppliers.clear()

    val dec = decorScore(state.layout, getLocation(state.locationId))
    today.decorations = dec.total

    val avgWait = if (today.waitCount > 0) today.waitSum / today.waitCount else 0.0
    val avgMood = if (today.moodCount > 0) today.moodSum / today.moodCount else 0.0
    val profit = today.revenue + today.tips - today.spend

    val record = com.dreamrestaurant.core.DailyRecord(
        day = state.day,
        locationId = state.locationId,
        weather = today.weather,
        revenue = round(today.revenue).toInt(),
        tips = round(today.tips).toInt(),
        spend = round(today.spend).toInt(),
        profit = round(profit).toInt(),
        inventory = round(today.inventory).toInt(),
        wages = round(today.wages).toInt(),
        rent = round(today.rent).toInt(),
        utilities = utilities,
        repairs = round(today.repairs).toInt(),
        guests = today.guests,
        parties = today.parties,
        served = today.served,
        angry = today.angry,
        avgWaitSec = round(avgWait * 60).toInt(),
        avgMood = round(avgMood * 10) / 10,
        complaints = HashMap(today.complaints),
        decor = dec.total,
        repCommunity = round(state.reputation.community * 10) / 10,
        repOutside = round(state.reputation.outside * 10) / 10,
        fame = round(state.fame * 10) / 10,
        stars = state.stars,
        magazineRank = state.stats.magazine.lastTotalRank,
        dishScoreAvg = avgOf(state.sim.todayDishScores),
        valueScoreAvg = avgOf(state.sim.todayValueScores)
    )
    state.stats.history.add(record)
    if (state.stats.history.size > 400) state.stats.history.subList(0, state.stats.history.size - 400).clear()

    state.stats.today = emptyToday()
    return record
}

fun decorScoreOf(state: GameState): DecorResult =
    decorScore(state.layout, getLocation(state.locationId))
