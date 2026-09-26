package com.dreamrestaurant.sim

import com.dreamrestaurant.core.Appearance
import com.dreamrestaurant.core.B
import com.dreamrestaurant.core.Customer
import com.dreamrestaurant.core.GameState
import com.dreamrestaurant.core.Member
import com.dreamrestaurant.core.OrderLine
import com.dreamrestaurant.core.Rng
import com.dreamrestaurant.core.WT
import com.dreamrestaurant.core.pushLog
import com.dreamrestaurant.data.getDish
import com.dreamrestaurant.data.furnitureById
import com.dreamrestaurant.data.getLocation
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import com.dreamrestaurant.core.round

/**
 * 對應 src/sim/customer.js
 * ARRIVING → QUEUEING → TO_SEAT → ORDERING → WAITING_FOOD → EATING → PAYING → LEAVING
 *                                      ↘ ANGRY（等太久／沒菜／沒位子／環境太差）
 */

val LOCATION_TYPE_BIAS = mapOf(
    "zhongli_xinming" to mapOf("student" to 1.5, "family" to 1.2, "regulars" to 1.3, "soldiers" to 1.4, "colleagues" to 0.9, "couple" to 1.0),
    "yilan_luodong" to mapOf("family" to 1.5, "regulars" to 1.4, "elderly" to 1.3, "cyclists" to 1.3, "kids_party" to 1.2, "tour_group" to 0.9),
    "keelung_miaokou" to mapOf("tourist" to 1.5, "tour_group" to 1.6, "family" to 1.3, "elderly" to 1.3, "office" to 0.7),
    "chiayi_wenhua" to mapOf("student" to 1.4, "family" to 1.4, "regulars" to 1.3, "elderly" to 1.2, "blogger" to 1.2, "couple" to 1.1),
    "taipei_nanyang" to mapOf("office" to 1.9, "colleagues" to 1.7, "student" to 1.3, "cyclist" to 1.1, "cyclists" to 1.2, "tour_group" to 0.6),
    "taichung_zhonghua" to mapOf("couple" to 1.5, "student" to 1.3, "kids_party" to 1.3, "blogger" to 1.3, "regulars" to 1.2),
    "tainan_dongdi" to mapOf("family" to 1.6, "kids_party" to 1.6, "elderly" to 1.5, "office" to 0.8, "couple" to 1.1),
    "changhua_baguashan" to mapOf("family" to 1.6, "regulars" to 1.5, "elderly" to 1.4, "soldiers" to 1.2, "blogger" to 1.1, "tourist" to 0.9),
    "hualien_dongdamen" to mapOf("tourist" to 1.7, "tour_group" to 1.7, "cyclists" to 1.5, "family" to 1.2, "office" to 0.6),
    "tainan_anping" to mapOf("tourist" to 1.6, "family" to 1.5, "elderly" to 1.4, "blogger" to 1.3, "cyclists" to 1.2, "office" to 0.7),
    "kaohsiung_xinkujiang" to mapOf("couple" to 1.8, "blogger" to 1.6, "colleagues" to 1.4, "student" to 1.2, "elderly" to 0.7),
    "hsinchu_science_park" to mapOf("office" to 2.0, "colleagues" to 1.8, "vip" to 1.5, "critic" to 1.3, "blogger" to 1.3, "student" to 0.7, "elderly" to 0.6),
    "pingtung_kenting" to mapOf("tourist" to 1.8, "couple" to 1.6, "tour_group" to 1.5, "cyclists" to 1.4, "kids_party" to 1.2, "office" to 0.6),
    "penghu_magong" to mapOf("tourist" to 1.9, "tour_group" to 1.8, "vip" to 1.6, "critic" to 1.5, "blogger" to 1.4, "couple" to 1.2, "student" to 0.5)
)

fun typeName(type: String): String = B.CUSTOMER_TYPE_MAP[type]?.name ?: "顧客"

/** 這一組幾個人的範圍 */
fun partyRange(type: String): Pair<Int, Int> {
    val t = B.CUSTOMER_TYPE_MAP[type] ?: return 1 to 2
    return t.partyMin to t.partyMax
}

/** 依地點顧客組成＋知名度抽出顧客類型 */
fun pickCustomerType(state: GameState, rng: Rng): String {
    val loc = getLocation(state.locationId)
    val mix = loc?.customerMix ?: mapOf(
        "student" to 0.4, "office" to 0.2, "family" to 0.3,
        "tourist" to 0.08, "critic" to 0.015, "vip" to 0.005
    )
    val bias = LOCATION_TYPE_BIAS[state.locationId] ?: emptyMap()
    val h = state.minute / 60.0
    val fame = state.fame
    val weights = mutableListOf<WT<String>>()
    for (t in B.CUSTOMER_TYPES) {
        val type = t.id
        var w = B.TYPE_BASE_WEIGHT[type] ?: 1.0
        val share = mix[type]
        if (share != null) w *= clamp(share / 0.15, 0.35, 2.4)
        w *= bias[type] ?: 1.0
        if (type == "critic") w *= 0.6 + fame / 28
        if (type == "blogger") w *= 0.7 + fame / 22
        if (type == "vip") w *= 0.6 + fame / 26
        if (type == "tourist") w *= 0.7 + state.stars * 0.12 + fame / 130
        if (type == "tour_group") w *= 0.5 + state.stars * 0.2 + fame / 90
        if (h >= 11 && h < 14) {
            if (type == "office") w *= 2.2
            if (type == "colleagues") w *= 1.8
            if (type == "couple") w *= 0.6
        }
        if (h >= 14 && h < 17) {
            if (type == "cyclists" || type == "elderly") w *= 1.6
            if (type == "office") w *= 0.6
        }
        if (h >= 17 && h < 21) {
            if (type == "family" || type == "kids_party" || type == "colleagues") w *= 1.7
            if (type == "couple") w *= 1.5
        }
        if (h >= 21) {
            if (type == "student" || type == "soldiers") w *= 1.7
            if (type == "family" || type == "kids_party" || type == "elderly") w *= 0.5
        }
        if (h < 11 && h >= 6) {
            if (type == "elderly" || type == "office") w *= 1.4
        }
        weights.add(WT(type, max(0.0001, w)))
    }
    return rng.weighted(weights) ?: "student"
}

fun makeCustomer(state: GameState, rng: Rng, typeOpt: String? = null): Customer {
    var forced: String? = null
    if (typeOpt == null && state.sim.forceTypeLeft > 0 && state.sim.forceType != null) {
        forced = state.sim.forceType
        state.sim.forceTypeLeft -= 1
    }
    val type = typeOpt ?: forced ?: pickCustomerType(state, rng)
    val patienceRange = B.PATIENCE[type] ?: intArrayOf(40, 60)
    val (pMin, pMax) = partyRange(type)
    val starCap = 2 + clamp(state.stars, 1, B.MAX_STARS)
    val partySize = clamp(rng.int(pMin, pMax), 1, min(9, starCap))
    val outside = rollOutside(state, rng)
    val spawn = state.layout.outside
    val uid = "c${state.day}_${state.sim.customersSpawned}_${floor(rng.next() * 9999).toInt()}"
    val look = randomAppearance(rng)
    val sheet = if (type == "cherish") "cherish" else null
    if (sheet != null) {
        look.sheet = sheet
        look.name = typeName(type)
    }
    val customer = Customer(
        uid = uid,
        type = type,
        appearance = look,
        mood = rng.range(0.0, 12.0),
        patience = rng.range(patienceRange[0].toDouble(), patienceRange[1].toDouble()) *
            (if (type == "office") 0.85 else 1.0) * (1 + (partySize - 1) * B.PARTY_PATIENCE_BONUS),
        budget = 0.0,
        partySize = partySize,
        x = spawn.x,
        y = spawn.y,
        dir = "N",
        frame = 0.0,
        path = mutableListOf(),
        pathIndex = 0,
        state = "arriving",
        enterMinute = absMinute(state),
        wasCritic = type == "critic" || type == "vip",
        outsideRoll = outside,
        prefTaste = clamp(
            (B.CUSTOMER_TYPE_MAP[type]?.taste ?: 55) + rng.range(-12.0, 12.0),
            0.0, 100.0
        ),
        prefTags = B.CUSTOMER_TYPE_MAP[type]?.tags ?: emptyList(),
        memberLooks = MutableList(max(0, partySize - 1)) { randomAppearance(rng) }
    )
    state.sim.customersSpawned += 1
    state.sim.customers.add(customer)
    state.stats.today.guests += partySize
    state.stats.today.parties += 1
    return customer
}

/* --------------------------------------------------------------- 動線移動 */

class MoveResult(val arrived: Boolean, val moved: Boolean)

/** 沿路徑移動。回傳 { arrived, moved } */
fun moveEntity(
    layout: Layout,
    e: PathEntity,
    dtMin: Double,
    tilesPerMinute: Double = B.WALK_TILES_PER_MIN
): MoveResult {
    if (e.path.isEmpty() || e.pathIndex >= e.path.size) return MoveResult(true, false)
    val step = tilesPerMinute * dtMin
    val bx = e.x
    val by = e.y
    val res = advanceAlong(e.path, e.pathIndex, e.x, e.y, step, ::dirFromDelta)
    e.x = res.x; e.y = res.y; e.pathIndex = res.index
    if (res.dir != null) e.dir = res.dir
    val moved = bx != e.x || by != e.y
    if (moved) e.frame = (e.frame + dtMin * 2.4) % 2 else e.frame = 0.0
    if (res.arrived) {
        e.path = mutableListOf()
        e.pathIndex = 0
    }
    return MoveResult(res.arrived, moved)
}

fun setPathTo(layout: Layout, e: PathEntity, target: P): Boolean {
    val from = P(round(e.x).toInt(), round(e.y).toInt())
    val to = P(round(target.x).toInt(), round(target.y).toInt())
    val path = findPath(layout, from, to) ?: return false
    e.path = path
    e.pathIndex = 0
    return true
}

fun atTile(e: PathEntity, t: P, tol: Double = 0.12): Boolean =
    abs(e.x - t.x) <= tol && abs(e.y - t.y) <= tol

/* ------------------------------------------------------------- 菜單與計分 */

fun cookTimeScore(cookTime: Int?): Double {
    val t = cookTime ?: 25
    return when {
        t < 8 -> 5.0
        t < 15 -> 45.0
        t < 20 -> 72.0
        t <= 40 -> 95.0
        t <= 50 -> 68.0
        else -> 40.0
    }
}

fun tasteMatch(entry: com.dreamrestaurant.core.MenuEntry, customer: Customer): Double =
    clamp(100 - abs(entry.taste - customer.prefTaste) * 1.4, 0.0, 100.0)

fun dishScoreFor(
    state: GameState,
    entry: com.dreamrestaurant.core.MenuEntry,
    customer: Customer,
    chefSkill: Int = 45
): Double {
    val def = getDish(entry.dishId)
    val cookScore = cookTimeScore(entry.cookTime)
    var score = (chefSkill * 0.4) + (entry.grade * 0.35) +
        (tasteMatch(entry, customer) * 0.15) + (cookScore * 0.10)
    if (state.sim.equipBroken.stove) score *= 0.62
    val cat = def?.category
    if (cat == "drink" || cat == "alcohol") {
        score = score * 0.35 + entry.grade * 0.45 + (cookScore * 0.2)
    }
    return clamp(score, 0.0, 100.0)
}

fun valueScoreFor(entry: com.dreamrestaurant.core.MenuEntry): Double {
    val def = getDish(entry.dishId)
    val expect = (def?.expectedPrice ?: ((def?.baseCost ?: 20) * 7)).toDouble()
    return clamp(expect / max(1.0, entry.price.toDouble()), 0.0, 1.4)
}

/** 顧客點餐：必須至少有一道主食有庫存，否則生氣離開 */
fun chooseOrder(state: GameState, customer: Customer, rng: Rng): MutableList<OrderLine>? {
    val active = state.menu.filter { m -> m.active && (state.stock[m.dishId] ?: 0) > 0 }
    if (active.isEmpty()) return null

    fun weightOf(entry: com.dreamrestaurant.core.MenuEntry): Double {
        val def = getDish(entry.dishId)
        val pop = def?.popularity?.get(state.locationId) ?: 1.0
        var tagScore = 1.0
        for (tag in def?.tags ?: emptyList()) if (tag in customer.prefTags) tagScore += 0.35
        val value = valueScoreFor(entry)
        return max(0.05, pop * tagScore * (0.4 + value * 0.8))
    }

    val staples = active.filter { getDish(it.dishId)?.category == "staple" }
    if (staples.isEmpty()) return null

    val party = clamp(customer.partySize, 1, 8)
    val base = 1 + (party - 1) / 2
    val count = clamp(base + (if (rng.chance(0.35)) 1 else 0), 1, 4)
    val picked = mutableListOf<com.dreamrestaurant.core.MenuEntry>()
    val staple = rng.weighted(staples.map { WT(it, weightOf(it)) })
    if (staple != null) picked.add(staple)

    for (i in 1 until count) {
        val pool = active.filter { m ->
            picked.none { p -> p.dishId == m.dishId } && getDish(m.dishId)?.category != "staple"
        }
        if (pool.isEmpty()) break
        val p = rng.weighted(pool.map { WT(it, weightOf(it)) })
        if (p == null) break else picked.add(p)
    }
    if (rng.chance(0.35)) {
        val evening = state.minute >= 16 * 60
        val drinks = active.filter { m ->
            val def = getDish(m.dishId) ?: return@filter false
            if (def.category == "drink") true else def.category == "alcohol" && evening
        }
        if (drinks.isNotEmpty()) {
            val p = rng.weighted(drinks.map { WT(it, weightOf(it)) })
            if (p != null) picked.add(p)
        }
    }

    val chefSkill = bestChefSkill(state)
    val out = mutableListOf<OrderLine>()
    for (entry in picked) {
        out.add(
            OrderLine(
                dishId = entry.dishId,
                price = entry.price,
                cookTime = entry.cookTime,
                grade = entry.grade,
                taste = entry.taste,
                portion = entry.portion,
                score = dishScoreFor(state, entry, customer, chefSkill),
                value = valueScoreFor(entry),
                ready = false,
                delivered = false
            )
        )
    }
    return out
}

fun bestChefSkill(state: GameState): Int {
    val chefs = state.staff.filter { it.role == "chef" && it.working }
    if (chefs.isEmpty()) return if (state.staff.any { it.role == "chef" }) 40 else 30
    return chefs.maxOf { it.skill }
}

/* ------------------------------------------------------------------- 心情 */

fun comfortBand(state: GameState): Pair<Int, Int> {
    val weather = state.sim.weather.ifEmpty { "sunny" }
    val shift = B.WEATHER_COMFORT_SHIFT[weather] ?: 0
    return (B.COMFORT_MIN + shift) to (B.COMFORT_MAX + shift)
}

fun temperatureDeviation(state: GameState): Double {
    val band = comfortBand(state)
    if (state.sim.equipBroken.ac) return 2.5
    return max(0.0, max(band.first - state.settings.acTemp, state.settings.acTemp - band.second).toDouble())
}

/**
 * 就座：把整組人安排到 seats 這些座位上（第一個是首領坐的位置）。
 */
fun seatParty(state: GameState, customer: Customer, table: TableState, seatIndices: List<Int>): Boolean {
    val seats = seatIndices.mapNotNull { i -> table.seats.getOrNull(i) }
    if (seats.isEmpty()) return false
    customer.seat = P(seats[0].x, seats[0].y)
    customer.seatedDir = seats[0].facing
    customer.dir = seats[0].facing
    customer.seatIndices = seatIndices.take(seats.size).toMutableList()
    customer.members = seats.drop(1).mapIndexed { i, s ->
        Member(
            seat = P(s.x, s.y),
            dir = s.facing,
            appearance = customer.memberLooks.getOrNull(i) ?: customer.appearance,
            eating = false,
            frame = i % 2
        )
    }.toMutableList()
    if (!table.occupants.contains(customer.uid)) table.occupants.add(customer.uid)
    table.state = "occupied"
    return true
}

/** 客人離場時把成員清掉 */
fun clearParty(customer: Customer) {
    customer.members = mutableListOf()
    customer.seatIndices = mutableListOf()
}

/** 這組人吃飯要吃多久 */
fun eatingMinutes(customer: Customer): Double =
    B.EATING_MIN + customer.order.size * B.EATING_PER_PORTION +
        max(0, customer.partySize - 1) * B.EATING_PER_GUEST

fun updateMood(state: GameState, c: Customer, dtMin: Double): Double {
    val dirt = state.sim.dirt
    val loc = getLocation(state.locationId)
    var delta = 0.0

    if (c.state == "queueing") delta -= 0.5
    if (c.state == "ordering") delta -= 0.2
    if (c.state == "waitingFood") {
        val orderAt = c.orderMinute ?: absMinute(state)
        val waited = absMinute(state) - orderAt
        delta -= 0.45 * clamp(waited / max(8.0, c.patience), 0.0, 1.5)
    }
    if (c.state == "paying") delta -= 0.4
    if (c.state == "eating") {
        val quality = (c.dishScoreAvg - 50) / 50
        delta += 0.9 * quality
        delta += 0.25
    }
    var env = temperatureDeviation(state) * 0.24
    if (dirt.floor > B.DIRT_BAD) env += 0.3 else if (dirt.floor > B.DIRT_COMPLAIN) env += 0.12
    if (dirt.restroom > B.DIRT_BAD) env += 0.32 else if (dirt.restroom > B.DIRT_COMPLAIN) env += 0.14
    if (state.sim.equipBroken.ac) env += 0.12
    delta -= min(0.85, env)

    val appeal = B.MUSIC_APPEAL[state.settings.music]?.get(c.type) ?: 0.2
    delta += appeal * 0.3

    if (loc?.decorStyle == "fashion" && state.settings.music == "off") delta -= 0.1

    c.mood = clamp(c.mood + delta * dtMin, -100.0, 100.0)
    return c.mood
}

fun setBubble(c: Customer, kind: String, state: GameState, minutes: Double = 3.0) {
    c.bubble = kind
    c.bubbleKind = kind
    c.bubbleUntil = absMinute(state) + minutes
}

/* --------------------------------------------------------------- 離場處理 */

val REASON_TEXT = mapOf(
    "wait_too_long" to "等太久",
    "no_table" to "等不到位子",
    "sold_out" to "點不到餐",
    "unhappy" to "環境或服務太差",
    "closed" to "打烊被趕"
)

fun customerLeaves(state: GameState, c: Customer, reason: String? = null): Customer {
    if (c.departing || c.done) return c
    val angry = reason != null
    c.leftAngry = angry
    c.state = if (angry) "angry" else "leaving"
    c.leaveReason = reason
    clearParty(c)
    c.leaveMinute = absMinute(state)

    if (c.seat != null && c.tableUid != null) releaseSeat(state, c)

    if (angry) {
        state.stats.today.angry += c.partySize
        if (reason == "no_table" && c.partySize >= 4) state.stats.today.noBigTable += 1
        if (!c.complained) recordComplaint(state, c, reason)
        setBubble(c, "angry", state, 2.5)
    }

    val door = state.layout.door
    val outside = state.layout.outside
    val path = findPath(state.layout, P(round(c.x).toInt(), round(c.y).toInt()), door)
    if (path != null) {
        path.add(P(outside.x, outside.y))
        c.path = path
        c.pathIndex = 0
        c.departing = true
    } else {
        c.done = true
    }

    val mood = applyCustomerMood(state, c)
    state.stats.today.moodSum += c.mood
    state.stats.today.moodCount += 1
    state.sim.todayMoods.add(c.mood)
    c.ratingBucket = mood.bucket
    c.ratingDelta = mood.delta

    state.sim.visitLog.add(
        com.dreamrestaurant.core.VisitEntry(
            type = c.type,
            enter = c.enterMinute,
            seat = c.seatMinute,
            order = c.orderMinute,
            food = c.firstFoodMinute ?: c.orderMinute ?: c.enterMinute,
            leave = absMinute(state),
            reason = reason ?: "served",
            mood = round(c.mood).toInt(),
            spent = c.spent,
            dishes = c.order.size,
            partySize = c.partySize
        )
    )
    if (state.sim.visitLog.size > 300) state.sim.visitLog.removeAt(0)
    return c
}

fun recordComplaint(state: GameState, c: Customer, reason: String): com.dreamrestaurant.core.Complaint {
    c.complained = true
    val entry = com.dreamrestaurant.core.Complaint(
        reason = reason,
        type = c.type,
        day = state.day,
        minute = floor(state.minute.toDouble()).toInt(),
        mood = round(c.mood).toInt(),
        wait = round(c.waitMin).toInt()
    )
    state.sim.complaintLog.add(0, entry)
    if (state.sim.complaintLog.size > 60) state.sim.complaintLog.removeAt(state.sim.complaintLog.size - 1)
    state.stats.today.complaints[reason] = (state.stats.today.complaints[reason] ?: 0) + 1
    return entry
}

/* ------------------------------------------------------------------ 就座 */

fun seatAt(state: GameState, c: Customer, table: TableState, seat: com.dreamrestaurant.sim.Seat) {
    c.tableUid = table.uid
    c.seat = P(seat.x, seat.y)
    c.seatedDir = seat.facing
    c.dir = seat.facing
    c.state = "ordering"
    c.seatMinute = absMinute(state)
    if (!table.occupants.contains(c.uid)) table.occupants.add(c.uid)
    table.state = "occupied"
    val decor = decorAvg(state)
    c.mood = clamp(c.mood + clamp((decor - 40) / 12.0, -8.0, 8.0), -100.0, 100.0)
    c.partyVoice = clamp(0.85 + 0.15 * c.partySize, 1.0, 1.6)
}

fun releaseSeat(state: GameState, c: Customer) {
    val table = state.sim.tables.firstOrNull { it.uid == c.tableUid }
    if (table != null) {
        table.occupants.removeAll { it == c.uid }
        if (table.occupants.isEmpty()) {
            table.state = "dirty"
            table.dirtySince = state.minute.toDouble()
        }
    }
    c.tableUid = null
    c.seat = null
    clearParty(c)
}

fun decorAvg(state: GameState): Double {
    val items = state.layout.items
    if (items.isEmpty()) return 0.0
    var total = 0.0
    for (it in items) {
        total += furnitureById(it.typeId)?.decorScore ?: 0
    }
    return total / max(1, items.size).toDouble()
}
