package com.dreamrestaurant.data

import com.dreamrestaurant.core.round

import com.dreamrestaurant.core.Rng
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

// 資料查詢函式：對應 src/data 目錄的 helper（唯一來源是生成的資料表）

fun getDish(id: String?): Dish? = DISHES.firstOrNull { it.id == id }

fun dishesForStars(stars: Int): List<Dish> {
    val s = if (stars == 0) 0 else stars
    return DISHES.filter { it.unlockStars <= s }
}

fun staffById(id: String?): StaffDef? = STAFF_POOL.firstOrNull { it.id == id }

fun getLocation(id: String?): LocationDef? = LOCATIONS.firstOrNull { it.id == id }

fun locationsForStars(stars: Int): List<LocationDef> {
    val s = if (stars == 0) 0 else stars
    return LOCATIONS.filter { it.starsRequired <= s }
}

fun furnitureById(id: String?): FurnitureDef? = FURNITURE.firstOrNull { it.id == id }

fun furnitureByCategory(cat: String): List<FurnitureDef> = FURNITURE.filter { it.category == cat }

fun equipmentList(): List<FurnitureDef> = FURNITURE.filter { it.category == "equipment" }

fun eventById(id: String?): EventDef? = EVENTS.firstOrNull { it.id == id }

fun eventsFor(stars: Int, locationId: String?): List<EventDef> {
    val s = stars
    return EVENTS.filter { e ->
        s >= e.minStars && s <= e.maxStars && (e.locations.isNullOrEmpty() || locationId in e.locations)
    }
}

data class Candidate(val candidateId: String, val staffId: String, val askWage: Double)

private fun qualityOf(staff: StaffDef): Double = (staff.speed + staff.skill + staff.stamina) / 3.0

private fun roundHalf(x: Double): Double = round(x * 2.0) / 2.0

/** 今日應徵者名單（決定性：同 (day, count, rng) 必同結果） */
fun makeCandidateList(day: Int, count: Int, rng: Rng): List<Candidate> {
    val d = max(1, floor(day.toDouble()).toInt())
    val n = max(0, floor(count.toDouble()).toInt())
    if (n == 0) return emptyList()

    val cap = min(97.0, 54.0 + (d - 1) * 1.0)
    var pool = STAFF_POOL.filter { qualityOf(it) <= cap }

    if (pool.size < n + 2) {
        pool = STAFF_POOL.sortedBy { qualityOf(it) }.take(min(STAFF_POOL.size, n + 3))
    }

    val shuffled = rng.shuffle(pool)
    val inflation = 1 + min(0.3, (d - 1) * 0.004)
    val out = mutableListOf<Candidate>()
    for (i in 0 until n) {
        val staff = shuffled[i % shuffled.size]
        val q = qualityOf(staff)
        val greed = 0.85 + (q / 100.0) * 0.55
        val jitter = 0.94 + rng.next() * 0.14
        var ask = roundHalf(staff.wage * greed * inflation * jitter)
        if (ask < 1.5) ask = 1.5
        if (ask > 20.0) ask = 20.0
        out.add(Candidate("cand_${d}_${i}_${staff.id}", staff.id, ask))
    }
    return out
}
