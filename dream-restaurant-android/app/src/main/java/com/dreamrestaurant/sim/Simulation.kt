package com.dreamrestaurant.sim

import com.dreamrestaurant.core.round

import com.dreamrestaurant.core.B
import com.dreamrestaurant.core.Customer
import com.dreamrestaurant.core.DailyRecord
import com.dreamrestaurant.core.GameState
import com.dreamrestaurant.core.Rng
import com.dreamrestaurant.core.UiMsg
import com.dreamrestaurant.core.emptyToday
import com.dreamrestaurant.core.pushLog
import com.dreamrestaurant.core.rollWeather
import com.dreamrestaurant.core.withRng
import com.dreamrestaurant.data.dishesForStars
import com.dreamrestaurant.data.getDish
import com.dreamrestaurant.data.getLocation
import com.dreamrestaurant.data.locationsForStars
import com.dreamrestaurant.data.makeCandidateList
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * 對應 src/sim/simulation.js —— 主模擬：時間推進、客流、顧客流程、每日結算
 * 純邏輯、不碰 DOM、所有亂數來自 state.rng（決定性）。
 */

/* --------------------------------------------------------------- 開始營業 */

fun beginDay(state: GameState): GameState {
    val rng = Rng((state.seed.toInt() xor (state.day * 7919)).toLong())
    val loc = getLocation(state.locationId)
    state.phase = "build"
    state.minute = max(0, state.settings.openMinute - 60)
    state.minuteFloat = state.minute.toDouble()
    state.stats.today = emptyToday()
    state.sim.weather = rollWeather(loc, rng)
    state.stats.today.weather = state.sim.weather
    state.sim.todayDishScores = mutableListOf()
    state.sim.todayValueScores = mutableListOf()
    state.sim.todayMoods = mutableListOf()
    state.sim.customers = mutableListOf()
    state.sim.tasks = mutableListOf()
    state.sim.kitchen = mutableListOf()
    state.sim.pass = mutableListOf()
    state.sim.activeEvents = mutableListOf()
    state.sim.trafficMul = 1.0
    state.sim.supplierPriceMul = 1.0
    state.sim.supplierPriceMulUntil = 0.0
    state.sim.eventTimer = rng.int(90, 200).toDouble()
    state.sim.spawnAccumulator = 0.0
    state.sim.customersSpawned = 0
    state.sim.customersLost = 0
    state.sim.skippedBigParties = 0
    state.sim.skippedBiggest = 0
    state.sim.dirt.floor = clamp(state.sim.dirt.floor * 0.7, 0.0, 100.0)
    state.sim.dirt.restroom = clamp(state.sim.dirt.restroom * 0.8, 0.0, 100.0)

    for (st in state.staff) {
        st.hoursToday = 0.0
        st.task = null
        st.path = mutableListOf()
        st.pathIndex = 0
        st.working = false
        st.state = "idle"
    }
    for (t in state.sim.tables) {
        t.occupants = mutableListOf()
        t.waiterUid = null
        if (t.state == "occupied") t.state = "clean"
    }

    val rent = loc?.rentPerDay ?: 1800
    state.cash -= rent
    state.stats.today.rent = rent.toDouble()
    state.stats.today.spend += rent

    if (state.day > 1 && state.day % 7 == 1) weeklyBonus(state)
    if (state.day % 7 == 1 || state.candidates.isEmpty()) {
        state.candidates = try {
            makeCandidateList(state.day, 5, rng).toMutableList()
        } catch (_: Throwable) {
            mutableListOf()
        }
    }

    spawnWalkers(state, rng, 6)
    rebuildTables(state)
    state.layout.rev = state.layout.rev + 1
    clearPathCache()
    val weatherName = B.WEATHER_NAME[state.sim.weather] ?: "晴天"
    pushLog(state, "第 ${state.day} 天開店準備（$weatherName）", "info")
    return state
}

fun startBusiness(state: GameState) {
    state.phase = "open"
    state.sim.closingSoon = false
    state.sim.lastOrderMinute = state.settings.closeMinute - B.CLOSING_SOON_MIN
    state.minute = state.settings.openMinute
    state.minuteFloat = state.settings.openMinute.toDouble()
    pushLog(state, "開始營業！", "good")
    state.uiQueue.add(UiMsg(type = "toast", message = "開始營業！祝生意興隆", kind = "good"))
}

/** 現在是不是「準備打烊」的時間內（打烊前 CLOSING_SOON_MIN 分鐘～打烊） */
fun isClosingSoon(state: GameState): Boolean {
    if (state.phase != "open") return false
    return state.settings.closeMinute - state.minute <= B.CLOSING_SOON_MIN
}

fun requestClose(state: GameState) {
    if (state.phase != "open") return
    state.phase = "closing"
    state.sim.closingSince = absMinute(state)
    pushLog(state, "打烊時間到，等客人離場…", "info")
}

/* --------------------------------------------------------------- 客流計算 */

/** 是否有服務生負責櫃台結帳 */
fun hasCashierOnShift(state: GameState): Boolean =
    state.staff.any { it.role == "waiter" && it.working && it.duties.cashier }

data class Availability(val freeSeats: Int, val usable: Int, val dirty: Int, val waiting: Int)

/** 目前有幾張桌子能坐下指定人數 */
fun tablesForParty(state: GameState, size: Int): List<TableState> {
    val need = clamp(size, 1, 8)
    return state.sim.tables.filter { t ->
        t.usable && t.state != "dirty" && freeSeatIndices(state, t).size >= need
    }
}

/** 店裡最大的桌子有幾個位子 */
fun biggestTableSeats(state: GameState): Int =
    state.sim.tables.maxOfOrNull { if (it.usable) it.seats.size else 0 } ?: 0

fun availability(state: GameState): Availability {
    var freeSeats = 0
    var usable = 0
    var dirty = 0
    for (t in state.sim.tables) {
        if (!t.usable) continue
        usable += 1
        if (t.state == "dirty") {
            dirty += 1
            continue
        }
        freeSeats += max(0, t.seats.size - t.occupants.size)
    }
    val waiting = state.sim.customers.count { it.state == "queueing" }
    return Availability(freeSeats, usable, dirty, waiting)
}

fun menuMatch(state: GameState): Double {
    val active = state.menu.filter { it.active }
    if (active.isEmpty()) return 0.7
    var sum = 0.0
    for (m in active) {
        sum += getDish(m.dishId)?.popularity?.get(state.locationId) ?: 1.0
    }
    return clamp(sum / active.size / 1.2, 0.6, 1.35)
}

fun priceFairness(state: GameState): Double {
    val active = state.menu.filter { it.active }
    if (active.isEmpty()) return 0.8
    var sum = 0.0
    for (m in active) sum += valueScoreFor(m)
    return clamp(sum / active.size, 0.6, 1.15)
}

fun spawnRate(state: GameState): Double {
    val loc = getLocation(state.locationId)
    val base = loc?.baseTraffic ?: 1.0
    val weather = B.WEATHER_TRAFFIC[state.sim.weather] ?: 1.0
    val hour = B.hourFactor(state.minute.toDouble())
    val fameFactor = 0.35 + (state.fame / 100) * 0.85
    val decorRaw = (state.stats.today.decorations.takeIf { it != 0 } ?: decorScoreOf(state).total).toDouble()
    val decor = clamp(0.85 + decorRaw / 1200, 0.85, 1.25)
    val stars = 0.75 + state.stars * 0.06
    var rate = (base * weather * hour * fameFactor * decor * menuMatch(state) * priceFairness(state) * stars *
        lureMultiplier(state) * trafficMultiplierFromEvents(state)) / 10
    val (freeSeats, _, _, waiting) = availability(state)
    if (freeSeats <= 0) rate *= 0.3
    if (waiting > 0) rate *= max(0.25, 1 - 0.3 * min(3, waiting))
    val seats = max(1, seatCount(state.sim.tables))
    val occupancy = clamp((seats - freeSeats).toDouble() / seats, 0.0, 1.0)
    rate *= 1 - 0.45 * occupancy
    val today = state.stats.today
    if (today.waitCount > 3) {
        val avgWait = today.waitSum / today.waitCount
        val stress = clamp(avgWait / 45, 0.0, 1.6)
        rate *= max(0.22, 1 - stress * 0.55)
    }
    val cap = max(0.02, seats * 0.045)
    return min(rate, cap)
}

/* ------------------------------------------------------------ 主模擬步進 */

fun stepSimulation(state: GameState, dtMin: Double) {
    if (!(dtMin > 0)) return
    if (state.phase == "build" || state.phase == "settle" || state.phase == "gameover") return

    withRng(state) { rng ->
        advanceClock(state, dtMin)

        if (state.phase == "open") {
            val left = state.settings.closeMinute - state.minute
            if (!state.sim.closingSoon && left <= B.CLOSING_SOON_MIN) {
                state.sim.closingSoon = true
                state.sim.lastOrderMinute = state.minute
                pushLog(
                    state,
                    "距離打烊還有 ${B.CLOSING_SOON_MIN} 分鐘：最後點餐，不再接待新客，開始收尾",
                    "info"
                )
                state.uiQueue.add(
                    UiMsg(
                        type = "toast",
                        message = "準備打烊：剩 ${B.CLOSING_SOON_MIN} 分鐘（最後點餐）",
                        kind = "info"
                    )
                )
            }
            if (state.minute >= state.settings.closeMinute) {
                requestClose(state)
            } else if (!state.sim.closingSoon) {
                spawnCustomers(state, dtMin, rng)
            }
        }

        refreshQueue(state)
        updateCustomers(state, dtMin, rng)
        updateStaff(state, dtMin, rng)
        updateRestaurant(state, dtMin, rng)
        tickEvents(state, dtMin, rng)
        expireEvents(state)
        updateWalkers(state, dtMin, rng)
        decayLure(state, dtMin)
        deliverSuppliers(state)
        autoTasks(state)

        if (state.phase == "closing" && state.sim.customers.isEmpty()) {
            finishDay(state)
        }
        checkBankruptcy(state, dtMin)
    }
}

private fun advanceClock(state: GameState, dtMin: Double) {
    state.minuteFloat += dtMin
    state.absMinute += dtMin
    if (state.minuteFloat >= 1440) state.minuteFloat -= 1440
    state.minute = state.minuteFloat.toInt()
}

private fun spawnCustomers(state: GameState, dtMin: Double, rng: Rng) {
    val (freeSeats, _, _, waiting) = availability(state)
    if (waiting >= 5) return
    state.sim.spawnAccumulator += spawnRate(state) * dtMin * (if (freeSeats > 0) 1.0 else 0.35)
    val maxSeats = biggestTableSeats(state)
    while (state.sim.spawnAccumulator >= 1) {
        state.sim.spawnAccumulator -= 1
        val c = makeCustomer(state, rng)
        if (maxSeats > 0 && c.partySize > maxSeats) {
            state.sim.customers = state.sim.customers.filter { it.uid != c.uid }.toMutableList()
            state.stats.today.guests -= c.partySize
            state.stats.today.parties = max(0, state.stats.today.parties - 1)
            state.sim.customersSpawned -= 1
            state.sim.skippedBigParties += 1
            state.sim.skippedBiggest = max(state.sim.skippedBiggest, c.partySize)
            continue
        }
        val door = state.layout.door
        val outside = state.layout.outside
        c.x = outside.x
        c.y = outside.y
        val path = findPath(
            state.layout,
            P(door.x.toInt(), door.y.toInt()),
            P(door.x.toInt(), door.y.toInt() - 1)
        )
        c.path = path ?: mutableListOf()
        c.pathIndex = 0
        c.state = "arriving"
        if (c.type == "cherish") {
            pushLog(state, "常連の Cherish が來店（今日もおひとり様）", "good")
        }
    }
}

private fun setBubbleVia(state: GameState, c: Customer, kind: String) {
    c.bubble = kind
    c.bubbleUntil = absMinute(state) + 3
}

private fun updateCustomers(state: GameState, dtMin: Double, rng: Rng) {
    val keep = mutableListOf<Customer>()
    for (c in state.sim.customers) {
        c.waitMin = absMinute(state) - c.enterMinute
        if (c.bubbleUntil > 0 && absMinute(state) > c.bubbleUntil) c.bubble = null

        if (c.departing) {
            moveEntity(state.layout, c, dtMin)
            if (c.path.isEmpty()) c.done = true
            if (c.done) continue
            keep.add(c)
            continue
        }

        when (c.state) {
            "arriving" -> {
                val doorInside = P(state.layout.door.x.toInt(), state.layout.door.y.toInt() - 1)
                if (c.path.isNotEmpty()) {
                    moveEntity(state.layout, c, dtMin)
                    if (atTile(c, doorInside, 0.4)) enterQueue(state, c, doorInside)
                } else {
                    val dx = doorInside.x - c.x
                    val dy = doorInside.y - c.y
                    val dist = hypot(dx, dy)
                    val step = B.WALK_TILES_PER_MIN * dtMin
                    if (dist <= step || dist < 1e-4) {
                        c.x = doorInside.x
                        c.y = doorInside.y
                        enterQueue(state, c, doorInside)
                    } else {
                        c.x += (dx / dist) * step
                        c.y += (dy / dist) * step
                        c.dir = if (dx > 0) "E" else if (dx < 0) "W" else if (dy > 0) "S" else "N"
                        c.frame = (c.frame + dtMin * 2.4) % 2
                    }
                }
            }
            "queueing" -> {
                moveTowardQueueSlot(state, c, dtMin)
                updateMood(state, c, dtMin)
                val freeSeats = availability(state).freeSeats
                if (freeSeats > 0) tryCreateSeatTask(state, c)
                if (freeSeats > 0 && c.waitMin > 4 && !seatTaskClaimed(state, c)) {
                    selfSeat(state, c)
                } else if (c.waitMin > c.patience || c.mood <= B.MOOD_ANGRY_LEAVE) {
                    customerLeaves(state, c, if (freeSeats > 0) "wait_too_long" else "no_table")
                } else if (c.waitMin > c.patience * 0.6 && c.bubble == null) {
                    setBubbleVia(state, c, "clock")
                }
            }
            "toSeat" -> {
                if (!insideRestaurant(state, c)) {
                    val doorInside = P(state.layout.door.x.toInt(), state.layout.door.y.toInt() - 1)
                    if (moveTowardPoint(state, c, doorInside, dtMin) && c.seat != null) {
                        setPathTo(state.layout, c, c.seat!!)
                    }
                    if (c.waitMin > c.patience * 1.6) customerLeaves(state, c, "no_table")
                } else {
                    var blocked = false
                    if (c.path.isEmpty() && c.seat != null && !atTile(c, c.seat!!, 0.25)) {
                        if (!setPathTo(state.layout, c, c.seat!!)) {
                            customerLeaves(state, c, "no_table")
                            blocked = true
                        }
                    }
                    if (!blocked) {
                        moveEntity(state.layout, c, dtMin)
                        if (c.seat != null && atTile(c, c.seat!!, 0.22)) {
                            val table = state.sim.tables.firstOrNull { it.uid == c.tableUid }
                            if (table != null) {
                                seatParty(
                                    state, c, table,
                                    if (c.seatIndices.isNotEmpty()) c.seatIndices else mutableListOf(0)
                                )
                            }
                            c.state = "ordering"
                            c.seatMinute = state.absMinute
                            c.dir = c.seatedDir.ifEmpty { "S" }
                            c.frame = 0.0
                        } else if (c.waitMin > c.patience * 1.3) {
                            customerLeaves(state, c, "no_table")
                        }
                    }
                }
            }
            "ordering" -> {
                updateMood(state, c, dtMin)
                if (state.sim.tasks.none { it.kind == "order" && it.customerUid == c.uid }) {
                    createTask(state, "order", tableUid = c.tableUid, customerUid = c.uid)
                }
                if (c.waitMin > c.patience * 1.4) customerLeaves(state, c, "wait_too_long")
            }
            "waitingFood" -> {
                updateMood(state, c, dtMin)
                if (c.waitMin > c.patience) customerLeaves(state, c, "wait_too_long")
            }
            "eating" -> {
                updateMood(state, c, dtMin)
                if (c.eatDoneMinute == null) {
                    c.eatDoneMinute =
                        absMinute(state) + B.EATING_MIN + (c.order.size * B.EATING_PER_PORTION)
                }
                state.absEatDone = c.eatDoneMinute
                if (absMinute(state) >= c.eatDoneMinute!!) {
                    c.state = "paying"
                    if (hasCashierOnShift(state)) c.selfPayAt = absMinute(state) + 5
                    else createTask(state, "cash", tableUid = c.tableUid, customerUid = c.uid)
                }
            }
            "paying" -> {
                updateMood(state, c, dtMin)
                val selfPayAt = c.selfPayAt
                if (selfPayAt != null && absMinute(state) >= selfPayAt) {
                    collectPayment(state, c)
                } else {
                    val eatenDone = state.absEatDone ?: absMinute(state)
                    val waited = absMinute(state) - eatenDone
                    if (waited > 12) collectPayment(state, c)
                }
            }
            "leaving", "angry" -> {
                moveEntity(state.layout, c, dtMin)
                if (c.path.isEmpty()) c.done = true
            }
            else -> {}
        }

        if (c.done) {
            releaseSeat(state, c)
            if (c.leftAngry) state.sim.customersLost += 1
            continue
        }
        val absNow = absMinute(state)
        if (c.state != "eating" && c.waitMin > c.patience * 2.2) {
            customerLeaves(state, c, "wait_too_long")
        }
        if (state.phase == "closing") {
            val closingSince = state.sim.closingSince
            if (closingSince != null && absNow - closingSince > 90) {
                if (c.state != "leaving" && c.state != "angry") customerLeaves(state, c, "closed")
            }
        }
        keep.add(c)
    }
    state.sim.customers = keep
}

private fun enterQueue(state: GameState, c: Customer, doorInside: P) {
    c.state = "queueing"
    c.enterMinute = state.absMinute
    c.x = doorInside.x
    c.y = doorInside.y
    val stop = queueSlotAt(state, queueLength(state))
    c.queueTarget = stop
    if (!atTile(c, stop, 0.1)) setPathTo(state.layout, c, stop)
}

/** 目前有幾組在候位 */
private fun queueLength(state: GameState): Int =
    state.sim.customers.count { it.state == "queueing" }

/**
 * 候位隊伍的座標：從門口往外沿著人行道排成一條線。
 * index 0 最靠近門口。
 */
fun queueSlotAt(state: GameState, index: Int): P {
    val gh = state.layout.gridH
    val gw = state.layout.gridW
    val door = state.layout.door
    val lane = state.layout.sidewalk
    val dir = if (door.x <= gw / 2.0) 1 else -1
    val step = B.QUEUE_STEP
    val row = floor(index / 7.0)
    val col = index % 7
    var x = door.x + dir * (0.95 + col * step)
    x = clamp(x, lane.x0.toDouble(), lane.x1.toDouble())
    val y = lane.y + row * 0.55
    return P(x, y)
}

/** 線性走向一個點（店外沒有網格可以走 A*） */
private fun moveTowardPoint(
    state: GameState,
    c: Customer,
    target: P,
    dtMin: Double,
    speedMul: Double = 0.65
): Boolean {
    val dx = target.x - c.x
    val dy = target.y - c.y
    val dist = hypot(dx, dy)
    val step = B.WALK_TILES_PER_MIN * speedMul * dtMin
    if (dist <= step || dist < 0.02) {
        c.x = target.x
        c.y = target.y
        c.frame = 0.0
        return true
    }
    c.x += (dx / dist) * step
    c.y += (dy / dist) * step
    c.dir = if (abs(dx) > abs(dy)) {
        if (dx > 0) "E" else "W"
    } else {
        if (dy > 0) "S" else "N"
    }
    c.frame = (c.frame + dtMin * 1.6) % 2
    return false
}

/** 客人目前是不是站在餐廳裡可通行的格子上 */
private fun insideRestaurant(state: GameState, c: Customer): Boolean =
    isWalkableTile(state.layout, round(c.x).toInt(), round(c.y).toInt())

/** 讓候位客人沿著隊伍往前補位（線性移動，因為店外不在網格上） */
private fun moveTowardQueueSlot(state: GameState, c: Customer, dtMin: Double) {
    val slot = queueSlotAt(state, c.queueIndex)
    c.queueTarget = slot
    moveTowardPoint(state, c, slot, dtMin, 0.55)
}

/** 重排隊伍：先來的排前面 */
fun refreshQueue(state: GameState): Int {
    val waiting = state.sim.customers
        .filter { it.state == "queueing" }
        .sortedBy { it.enterMinute }
    waiting.forEachIndexed { i, c -> c.queueIndex = i }
    return waiting.size
}

private fun seatTaskClaimed(state: GameState, c: Customer): Boolean {
    val task = state.sim.tasks.firstOrNull { it.kind == "seat" && it.customerUid == c.uid }
    return task?.claimedBy != null
}

/** 客人自己找位子坐（服務生太忙時） */
private fun selfSeat(state: GameState, c: Customer): Boolean {
    val table = pickTableFor(state, c) ?: return false
    val free = freeSeatIndices(state, table)
    val need = clamp(c.partySize, 1, 8)
    if (free.size < need) return false
    val seatIndices = free.take(need).toMutableList()
    val seat = table.seats[seatIndices[0]] ?: return false
    state.sim.tasks =
        state.sim.tasks.filter { !(it.kind == "seat" && it.customerUid == c.uid) }.toMutableList()
    c.tableUid = table.uid
    c.seat = P(seat.x, seat.y)
    c.seatIndices = seatIndices
    c.seatedDir = seat.facing
    c.state = "toSeat"
    c.selfSeated = true
    if (insideRestaurant(state, c)) {
        if (!setPathTo(state.layout, c, P(seat.x, seat.y)) && !atTile(c, P(seat.x, seat.y), 0.3)) {
            c.tableUid = null
            c.seat = null
            c.state = "queueing"
            return false
        }
    }
    createTask(state, "order", tableUid = table.uid, customerUid = c.uid)
    return true
}

/** 這張桌子目前可用的座位索引 */
fun freeSeatIndices(state: GameState, table: TableState): List<Int> {
    val taken = mutableSetOf<String>()
    for (uid in table.occupants) {
        val other = state.sim.customers.firstOrNull { it.uid == uid } ?: continue
        if (other.seatIndices.isNotEmpty()) {
            for (ix in other.seatIndices) {
                val s = table.seats.getOrNull(ix) ?: continue
                taken.add("${s.x},${s.y}")
            }
        } else {
            val s0 = other.seat ?: continue
            taken.add("${s0.x},${s0.y}")
        }
    }
    for (task in state.sim.tasks) {
        if (task.kind != "seat" || task.tableUid != table.uid) continue
        val idxs = task.seatIndices ?: listOf(task.seatIndex ?: 0)
        for (ix in idxs) {
            val s = table.seats.getOrNull(ix) ?: continue
            taken.add("${s.x},${s.y}")
        }
    }
    val out = mutableListOf<Int>()
    table.seats.forEachIndexed { i, s ->
        if (!s.reachDoor || !s.reachPass) return@forEachIndexed
        if (taken.contains("${s.x},${s.y}")) return@forEachIndexed
        out.add(i)
    }
    return out
}

private fun tryCreateSeatTask(state: GameState, c: Customer) {
    if (state.sim.tasks.any { it.kind == "seat" && it.customerUid == c.uid }) return
    val table = pickTableFor(state, c) ?: return
    val free = freeSeatIndices(state, table)
    val need = clamp(c.partySize, 1, 8)
    if (free.size < need) return
    val seatIndices = free.take(need).toMutableList()
    createTask(
        state, "seat",
        tableUid = table.uid, customerUid = c.uid,
        seatIndex = seatIndices[0], seatIndices = seatIndices
    )
}

/** 選桌：優先乾淨、離出餐口近、座位數剛好的桌子 */
fun pickTableFor(state: GameState, c: Customer): TableState? {
    val pass = state.layout.passTiles.firstOrNull() ?: P(3, 4)
    val options = mutableListOf<Pair<TableState, Double>>()
    for (t in state.sim.tables) {
        if (!t.usable || t.state == "dirty") continue
        val free = freeSeatIndices(state, t)
        val need = clamp(c.partySize, 1, 8)
        if (free.size < need) continue
        val dist = abs(t.x - pass.x) + abs(t.y - pass.y)
        val waste = free.size - need
        options.add(t to (20 - dist - waste * 1.5))
    }
    if (options.isEmpty()) return null
    return options.maxByOrNull { it.second }!!.first
}

/* ------------------------------------------------------ 環境、任務、到貨 */

private fun updateRestaurant(state: GameState, dtMin: Double, rng: Rng) {
    val seated = state.sim.customers.count { it.state == "eating" || it.state == "waitingFood" }
    state.sim.dirt.floor =
        clamp(state.sim.dirt.floor + seated * 0.008 * dtMin, 0.0, 100.0)
    state.sim.dirt.restroom =
        clamp(state.sim.dirt.restroom + seated * 0.02 * dtMin, 0.0, 100.0)

    if (rng.chance(0.0012 * dtMin)) {
        val items = state.layout.items.filter { !it.broken }
        val target = if (items.isNotEmpty()) rng.pick(items) else null
        if (target != null) {
            target.durability = clamp(target.durability - rng.int(4, 12), 0, 100)
            if (target.durability <= 8) {
                target.broken = true
                pushLog(state, "有傢俱壞掉了，記得維修", "warn")
            }
        }
    }
}

private fun autoTasks(state: GameState) {
    for (t in state.sim.tables) {
        if (t.state == "dirty" && t.occupants.isEmpty()) {
            createTask(state, "bus", tableUid = t.uid)
        }
    }
    if (state.sim.dirt.restroom > 45 &&
        state.staff.any { it.role == "waiter" && it.duties.cleanRestroom }
    ) {
        createTask(state, "cleanRestroom", cleanTarget = "restroom")
    }
    if (state.sim.dirt.floor > 55 && state.staff.any { it.role == "waiter" && it.duties.cleanFloor }) {
        createTask(state, "cleanFloor", cleanTarget = "floor")
    }
    for (c in state.sim.customers) {
        if (c.state == "paying" && state.sim.tasks.none { it.kind == "cash" && it.customerUid == c.uid }) {
            createTask(state, "cash", tableUid = c.tableUid, customerUid = c.uid)
        }
    }
}

private fun deliverSuppliers(state: GameState) {
    if (state.suppliers.isEmpty()) return
    val now = absMinute(state)
    val arrived = state.suppliers.filter { it.arriveMinute <= now }
    if (arrived.isEmpty()) return
    state.suppliers = state.suppliers.filter { it.arriveMinute > now }.toMutableList()
    for (s in arrived) {
        state.stock[s.dishId] = (state.stock[s.dishId] ?: 0) + s.servings
        pushLog(state, "${getDish(s.dishId)?.name ?: s.dishId} 進貨 ${s.servings} 份到貨", "info")
    }
    val list = arrived.joinToString("、") {
        "${getDish(it.dishId)?.name ?: it.dishId}×${it.servings}"
    }
    state.uiQueue.add(UiMsg(type = "toast", message = "進貨到貨：$list", kind = "good"))
}

private fun checkBankruptcy(state: GameState, dtMin: Double) {
    if (state.cash >= 0) return
    state.flags.negativeCashDays += dtMin / 1440
    if (state.flags.negativeCashDays >= B.BANKRUPT_DAYS) {
        state.phase = "gameover"
        pushLog(state, "資金週轉不靈，餐廳結束營業…", "bad")
        state.uiQueue.add(UiMsg(type = "gameover"))
    }
}

/* --------------------------------------------------------------- 每日結算 */

fun finishDay(state: GameState): DailyRecord {
    val record = finalizeDay(state)
    state.phase = "closed"
    state.minute = min(1439, state.settings.closeMinute)
    state.minuteFloat = state.minute.toDouble()
    dailyFame(state, record)

    var weekly: com.dreamrestaurant.core.WeeklyRecord? = null
    if (state.day % 7 == 0) {
        weekly = withRng(state) { rng -> runWeeklySettlement(state, rng) }
        checkStars(state)
        checkDropStar(state)
        checkAnnualAward(state)
        state.uiQueue.add(UiMsg(type = "settle", week = weekly.week, day = state.day))
    }

    if (state.cash >= 0) state.flags.negativeCashDays = 0.0

    for (st in state.staff) {
        st.fatigue = clamp(st.fatigue - B.FATIGUE_REST_PER_DAY, 0.0, 100.0)
    }
    withRng(state) { rng -> checkResignations(state, rng) }

    val revenue = String.format("%,d", record.revenue)
    val profit = String.format("%,d", record.profit)
    val kind = if (record.profit >= 0) "good" else "bad"
    pushLog(
        state,
        "第 ${state.day} 天結算：營業額 NT$ $revenue，淨利 NT$ $profit，來客 ${record.guests} 人",
        kind
    )
    state.uiQueue.add(UiMsg(type = "dayEnd", day = state.day, record = record))
    return record
}

/** 進入隔天 */
fun nextDay(state: GameState): Boolean {
    if (state.phase != "closed") return false
    state.day += 1
    beginDay(state)
    state.phase = "build"
    return true
}

/* ------------------------------------------------------------------ 工具 */

class RestaurantSummary(
    val locationName: String,
    val seats: Int,
    val tables: Int,
    val decor: Int,
    val staffOnShift: Int,
    val waiters: Int,
    val chefs: Int,
    val freeSeats: Int,
    val menuCount: Int,
    val unlocksAt: List<String>,
    val dishes: Int
)

fun restaurantSummary(state: GameState): RestaurantSummary {
    val loc = getLocation(state.locationId)
    val tables = state.sim.tables
    return RestaurantSummary(
        locationName = loc?.name ?: "",
        seats = seatCount(tables),
        tables = tables.count { it.usable },
        decor = decorScore(state.layout, loc).total,
        staffOnShift = state.staff.count { it.working },
        waiters = state.staff.count { it.role == "waiter" },
        chefs = state.staff.count { it.role == "chef" },
        freeSeats = availability(state).freeSeats,
        menuCount = state.menu.count { it.active },
        unlocksAt = locationsForStars(state.stars).map { it.name },
        dishes = dishesForStars(state.stars).size
    )
}
