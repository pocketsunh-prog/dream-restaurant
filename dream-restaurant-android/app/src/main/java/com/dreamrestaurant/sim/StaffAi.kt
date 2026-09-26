package com.dreamrestaurant.sim

import com.dreamrestaurant.core.B
import com.dreamrestaurant.core.GameState
import com.dreamrestaurant.core.HiredStaff
import com.dreamrestaurant.core.KitchenJob
import com.dreamrestaurant.core.PassItem
import com.dreamrestaurant.core.Rng
import com.dreamrestaurant.core.Task
import com.dreamrestaurant.core.pushLog
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import com.dreamrestaurant.core.round

/**
 * 對應 src/sim/staffai.js —— 員工 AI：排班、職務、任務分派、動線、廚房出餐
 * 考據：服務生負責的桌數與「廚房出餐口距離」相關；離廚房越遠負責桌數越少。
 */

private val TASK_PRIORITY = mapOf(
    "deliver" to 100, "order" to 95, "seat" to 88, "cash" to 85,
    "bus" to 50, "cleanRestroom" to 40, "cleanFloor" to 35
)

private var taskSeq = 1
private var kitchenSeq = 1

fun createTask(
    state: GameState,
    kind: String,
    tableUid: String? = null,
    customerUid: String? = null,
    cleanTarget: String? = null,
    seatIndex: Int? = null,
    seatIndices: MutableList<Int>? = null,
    stage: String? = null,
    delay: Int? = null
): Task {
    val dup = state.sim.tasks.firstOrNull { t ->
        t.kind == kind &&
            (tableUid == null || t.tableUid == tableUid) &&
            (customerUid == null || t.customerUid == customerUid) &&
            (cleanTarget == null || t.cleanTarget == cleanTarget)
    }
    if (dup != null) return dup
    val task = Task(
        id = "t${taskSeq++}",
        kind = kind,
        createdMinute = absMinute(state),
        tableUid = tableUid,
        customerUid = customerUid,
        cleanTarget = cleanTarget,
        seatIndex = seatIndex,
        seatIndices = seatIndices,
        stage = stage,
        delay = delay
    )
    state.sim.tasks.add(task)
    return task
}

fun cancelTasksFor(state: GameState, pred: (Task) -> Boolean) {
    state.sim.tasks = state.sim.tasks.filter { !pred(it) }.toMutableList()
}

fun onShift(state: GameState, st: HiredStaff): Boolean {
    if (!state.settings.openDays[(state.day - 1) % 7]) return false
    val m = state.minute
    val start = st.shift.start
    val end = st.shift.end
    if (start == end) return false
    return if (start < end) m >= start && m < end else m >= start || m < end
}

/** 該員工是否願意／能夠處理這個任務 */
fun canHandle(st: HiredStaff, task: Task): Boolean {
    val d = st.duties
    if (st.role == "chef") return false
    return when (task.kind) {
        "seat" -> d.escort
        "order" -> d.order
        "deliver" -> d.serve
        "bus" -> d.bus
        "cash" -> d.cashier || d.serve
        "cleanRestroom" -> d.cleanRestroom
        "cleanFloor" -> d.cleanFloor
        else -> false
    }
}

/** 任務的目標座標 */
fun taskTile(state: GameState, task: Task, stageOverride: String? = null): P {
    val layout = state.layout
    val stage = stageOverride ?: task.stage
    if (task.kind == "deliver") {
        if (stage == "pickup" || stage == null) {
            val pass = layout.passTiles
            return if (pass.isNotEmpty()) P(pass[0].x, pass[0].y) else P(1, 1)
        }
    }
    val table = state.sim.tables.firstOrNull { it.uid == task.tableUid }
    if (table != null && table.serviceTile != null) {
        val s = table.serviceTile!!
        return P(s.x, s.y)
    }
    if (task.kind == "seat") {
        val door = layout.door
        val sx = door.x.toInt()
        val sy = door.y.toInt() - 1
        return if (isWalkableTile(layout, sx, sy)) P(sx, sy) else P(door.x.toInt(), door.y.toInt())
    }
    if (task.kind == "cleanRestroom") {
        val r = layout.restroomTiles.firstOrNull()
        if (r != null) return nearestWalkableAdjacent(layout, r.x.toInt(), r.y.toInt())
    }
    if (task.kind == "cleanFloor") {
        val door = layout.door
        return P(door.x.toInt(), max(1, door.y.toInt() - 2))
    }
    val t0 = state.sim.tables.firstOrNull()
    return P(round(t0?.x?.toDouble() ?: 4.0).toInt(), round(t0?.y?.toDouble() ?: 6.0).toInt())
}

/** 對應 staffai.js 內的區域函式：只看八鄰格，找不到就回傳原格 */
private fun nearestWalkableAdjacent(layout: Layout, x: Int, y: Int): P {
    if (isWalkableTile(layout, x, y)) return P(x, y)
    for ((dx, dy) in listOf(0 to 1, 1 to 0, -1 to 0, 0 to -1, 1 to 1, -1 to 1, 1 to -1, -1 to -1)) {
        if (isWalkableTile(layout, x + dx, y + dy)) return P(x + dx, y + dy)
    }
    return P(x, y)
}

/** 距離越遠的服務生，能負責的桌數越少（原作核心設計） */
fun tableCapacityFor(state: GameState, st: HiredStaff, table: TableState): Int {
    val pass = state.layout.passTiles.firstOrNull() ?: P(3, 4)
    val dist = abs(table.x - pass.x) + abs(table.y - pass.y)
    val norm = clamp(dist / 18.0, 0.0, 1.0)
    val base = round(6 * (1 - norm * 0.8)).toInt()
    return clamp(base, 1, 6)
}

/** 更新員工（排班、薪資、疲勞、移動、任務） */
fun updateStaff(state: GameState, dtMin: Double, rng: Rng) {
    val hourFrac = (dtMin * 60) / 60

    for (st in state.staff) {
        val shouldWork = onShift(state, st) &&
            state.phase != "build" && state.phase != "settle" && state.phase != "gameover"
        if (shouldWork != st.working) {
            st.working = shouldWork
            if (!shouldWork) {
                st.task = null
                st.path = mutableListOf()
                st.pathIndex = 0
                st.state = "off"
                st.x = -1.0; st.y = -1.0
                if (st.role == "chef") releaseChef(state, st)
            } else {
                st.state = "idle"
                val home = if (st.role == "chef") chefSlot(state, st) else waiterPost(state, st)
                st.x = home.x; st.y = home.y
            }
        }
        if (!st.working) {
            st.fatigue = clamp(st.fatigue - B.FATIGUE_RECOVER_PER_HOUR * hourFrac, 0.0, 100.0)
            st.mood = clamp(st.mood + 1.6 * hourFrac, 0.0, 100.0)
            continue
        }

        val wageCost = (st.wage / 60.0) * dtMin
        state.cash -= wageCost
        state.stats.today.wages += wageCost
        state.stats.today.spend += wageCost
        st.hoursToday += hourFrac
        st.fatigue = clamp(st.fatigue + B.FATIGUE_PER_HOUR * hourFrac, 0.0, 100.0)
        st.mood = clamp(
            st.mood - (if (st.fatigue > B.FATIGUE_TIRED) 0.09 else 0.03) * dtMin,
            0.0, 100.0
        )
        st.speedMod = if (st.fatigue > B.FATIGUE_TIRED) 0.72 else 1.0

        if (st.role == "chef") {
            updateChef(state, st, dtMin)
            continue
        }
        updateWaiter(state, st, dtMin, rng)
    }
}

private fun waiterPost(state: GameState, st: HiredStaff): P {
    val pass = state.layout.passTiles.firstOrNull() ?: P(3, 5)
    val idx = state.staff.filter { it.role == "waiter" }.indexOf(st)
    val spots = listOf(
        P(pass.x, pass.y + 1),
        P(pass.x + 1, pass.y + 1),
        P(pass.x - 1, pass.y + 1),
        P(pass.x + 2, pass.y + 2)
    )
    val spot = spots[max(0, idx) % spots.size]
    return if (isWalkableTile(state.layout, spot.x.toInt(), spot.y.toInt())) spot else pass
}

private fun chefSlot(state: GameState, st: HiredStaff): P {
    val chefs = state.staff.filter { it.role == "chef" }
    val idx = chefs.indexOf(st)
    val kt = state.layout.kitchenTiles
    val k = min(kt.size - 1, max(0, idx) * 2 + 1)
    return kt.getOrElse(k) { P(2, 2) }
}

/* ------------------------------------------------------------------ 服務生 */

private fun updateWaiter(state: GameState, st: HiredStaff, dtMin: Double, rng: Rng) {
    if (st.task != null) {
        val task = state.sim.tasks.firstOrNull { it.id == st.task }
        if (task == null) {
            st.task = null; st.state = "idle"; return
        }
        val target = taskTile(state, task)
        if (atTile(st, target, 0.2) || st.path.isEmpty()) {
            if (st.path.isEmpty() && !atTile(st, target, 0.25)) {
                if (!setPathTo(state.layout, st, target)) {
                    abandonTask(state, st, task, "走不到"); return
                }
            }
            if (atTile(st, target, 0.25)) {
                performTask(state, st, task, rng)
                return
            }
        }
        moveEntity(
            state.layout, st, dtMin,
            B.WALK_TILES_PER_MIN * st.speedMod * (0.75 + st.speed / 200.0)
        )
        return
    }

    st.state = "idle"
    val task = pickTask(state, st)
    if (task == null) {
        if (st.path.isNotEmpty()) {
            moveEntity(state.layout, st, dtMin, B.WALK_TILES_PER_MIN * st.speedMod)
            return
        }
        val post = waiterPost(state, st)
        if (tileDistance(P(st.x, st.y), post) > 1.6) setPathTo(state.layout, st, post)
        if (st.path.isNotEmpty()) moveEntity(state.layout, st, dtMin, B.WALK_TILES_PER_MIN * st.speedMod)
        return
    }
    task.claimedBy = st.uid
    st.task = task.id
    st.state = "toTask"
    setPathTo(state.layout, st, taskTile(state, task))
}

private fun pickTask(state: GameState, st: HiredStaff): Task? {
    var best: Task? = null
    var bestScore = Double.NEGATIVE_INFINITY
    val pass = state.layout.passTiles.firstOrNull() ?: P(3, 4)
    for (task in state.sim.tasks) {
        if (task.claimedBy != null && task.claimedBy != st.uid) continue
        if (!canHandle(st, task)) continue
        val target = taskTile(state, task)
        val dist = tileDistance(P(st.x, st.y), target)
        val table = state.sim.tables.firstOrNull { it.uid == task.tableUid }
        val cap = if (table != null) tableCapacityFor(state, st, table) else 6
        val distPenalty = dist * 2 + (if (table != null) tileDistance(P(table.x, table.y), pass) * 0.4 else 0.0)
        val nowAbs = absMinute(state)
        val aging = min(60.0, nowAbs - (task.createdMinute)) * 1.1
        val score = (TASK_PRIORITY[task.kind] ?: 10) + aging - distPenalty + (cap - 3) * 1.2
        if (score > bestScore) {
            bestScore = score
            best = task
        }
    }
    return best
}

private fun abandonTask(state: GameState, st: HiredStaff, task: Task, why: String) {
    task.claimedBy = null
    st.task = null
    st.state = "idle"
    task.failed += 1
    if (task.failed > 4) {
        state.sim.tasks = state.sim.tasks.filter { it.id != task.id }.toMutableList()
    }
}

private fun performTask(state: GameState, st: HiredStaff, task: Task, rng: Rng) {
    when (task.kind) {
        "seat" -> doSeat(state, st, task)
        "order" -> doOrder(state, st, task, rng)
        "deliver" -> doDeliver(state, st, task)
        "bus" -> doBus(state, st, task)
        "cash" -> doCash(state, st, task)
        "cleanRestroom", "cleanFloor" -> doClean(state, st, task)
        else -> abandonTask(state, st, task, "未知任務")
    }
}

private fun finishTask(state: GameState, st: HiredStaff, task: Task) {
    state.sim.tasks = state.sim.tasks.filter { it.id != task.id }.toMutableList()
    st.task = null
    st.state = "idle"
}

private fun doSeat(state: GameState, st: HiredStaff, task: Task) {
    val c = state.sim.customers.firstOrNull { it.uid == task.customerUid }
    val table = state.sim.tables.firstOrNull { it.uid == task.tableUid }
    if (c == null || table == null || c.state != "queueing") return finishTask(state, st, task)
    val indices = if (!task.seatIndices.isNullOrEmpty()) task.seatIndices!!.toList()
    else listOf(task.seatIndex ?: 0)
    val seat = table.seats.getOrNull(indices[0]) ?: table.seats.firstOrNull()
        ?: return finishTask(state, st, task)
    releaseSeat(state, c)
    c.tableUid = table.uid
    c.seatIndices = indices.toMutableList()
    c.seat = P(seat.x, seat.y)
    c.state = "toSeat"
    setPathTo(state.layout, c, P(seat.x, seat.y))
    if (c.path.isEmpty() && !atTile(c, P(seat.x, seat.y), 0.2)) {
        seatParty(state, c, table, c.seatIndices)
        c.state = "ordering"
        c.seatMinute = absMinute(state)
    }
    createTask(state, "order", tableUid = table.uid, customerUid = c.uid, delay = 1)
    finishTask(state, st, task)
}

private fun doOrder(state: GameState, st: HiredStaff, task: Task, rng: Rng) {
    val c = state.sim.customers.firstOrNull { it.uid == task.customerUid }
    val table = state.sim.tables.firstOrNull { it.uid == task.tableUid }
    if (c == null || table == null || c.tableUid == null || c.departing) return finishTask(state, st, task)
    if (c.state == "toSeat") {
        task.waitingForSeat += 1
        if (task.waitingForSeat <= 3) return
        return finishTask(state, st, task)
    }
    if (c.state != "ordering") return finishTask(state, st, task)

    val order = chooseOrder(state, c, rng)
    if (order == null || order.isEmpty()) {
        customerLeaves(state, c, "sold_out")
        setBubble(c, "angry", state, 3.0)
        finishTask(state, st, task)
        return
    }
    c.order = order
    c.orderMinute = absMinute(state)
    c.state = "waitingFood"
    setBubble(c, "hungry", state, 2.0)
    for (item in order) {
        state.stock[item.dishId] = max(0, (state.stock[item.dishId] ?: 0) - 1)
        enqueueKitchen(state, c, table, item)
    }
    finishTask(state, st, task)
}

private fun customerGone(state: GameState, uid: String): Boolean {
    val c = state.sim.customers.firstOrNull { it.uid == uid } ?: return true
    return c.departing || c.done || c.state == "leaving" || c.state == "angry"
}

private fun doDeliver(state: GameState, st: HiredStaff, task: Task) {
    val table = state.sim.tables.firstOrNull { it.uid == task.tableUid }
        ?: return finishTask(state, st, task)

    if (task.stage == null || task.stage == "pickup") {
        val ready = state.sim.pass.filter { it.tableUid == task.tableUid }
        if (ready.isEmpty()) return finishTask(state, st, task)
        val alive = ready.filter { !customerGone(state, it.customerUid) }
        if (alive.isEmpty()) {
            state.sim.pass = state.sim.pass.filter { it.tableUid != task.tableUid }.toMutableList()
            return finishTask(state, st, task)
        }
        for (item in alive) item.pickedUp = true
        task.stage = "drop"
        st.task = task.id
        val target = taskTile(state, task, "drop")
        setPathTo(state.layout, st, target)
        return
    }
    val carried = state.sim.pass.filter { it.tableUid == task.tableUid && it.pickedUp }
    state.sim.pass =
        state.sim.pass.filter { !(it.tableUid == task.tableUid && it.pickedUp) }.toMutableList()
    for (item in carried) {
        if (customerGone(state, item.customerUid)) continue
        val c = state.sim.customers.firstOrNull { it.uid == item.customerUid } ?: continue
        val slot = c.order.firstOrNull { it.dishId == item.dishId && !it.delivered }
        if (slot != null) {
            slot.delivered = true
            slot.score = item.score
        }
        if (c.firstFoodMinute == null) {
            c.firstFoodMinute = absMinute(state)
            c.dishScoreAvg = item.score
            c.mood = clamp(c.mood + 8, -100.0, 100.0)
        } else {
            c.dishScoreAvg = (c.dishScoreAvg + item.score) / 2
        }
        state.sim.todayDishScores.add(item.score)
        if (c.order.all { it.delivered }) {
            c.state = "eating"
            c.eatDoneMinute = absMinute(state) + eatingMinutes(c)
            setBubble(c, "happy", state, 2.0)
            for (m in c.members) m.eating = true
            val waitMin = max(0.0, absMinute(state) - c.enterMinute)
            state.stats.today.waitSum += waitMin
            state.stats.today.waitCount += 1
        }
    }
    finishTask(state, st, task)
    if (state.sim.pass.any { it.tableUid == task.tableUid && !it.pickedUp }) {
        createTask(state, "deliver", tableUid = task.tableUid, customerUid = task.customerUid)
    }
}

private fun doBus(state: GameState, st: HiredStaff, task: Task) {
    val table = state.sim.tables.firstOrNull { it.uid == task.tableUid }
        ?: return finishTask(state, st, task)
    table.state = "clean"
    table.dirtySince = null
    state.sim.dirt.floor = clamp(state.sim.dirt.floor + 0.4, 0.0, 100.0)
    finishTask(state, st, task)
}

private fun doCash(state: GameState, st: HiredStaff, task: Task) {
    val c = state.sim.customers.firstOrNull { it.uid == task.customerUid }
        ?: return finishTask(state, st, task)
    val tableUid = c.tableUid
    collectPayment(state, c)
    val table = state.sim.tables.firstOrNull { it.uid == tableUid }
    if (table != null && table.occupants.isEmpty() && table.state == "dirty") {
        table.state = "clean"
        table.dirtySince = null
        state.sim.tasks =
            state.sim.tasks.filter { !(it.kind == "bus" && it.tableUid == table.uid) }.toMutableList()
    }
    finishTask(state, st, task)
}

private fun doClean(state: GameState, st: HiredStaff, task: Task) {
    if (task.kind == "cleanRestroom") state.sim.dirt.restroom = 0.0
    else state.sim.dirt.floor = 0.0
    finishTask(state, st, task)
}

class Payment(val spent: Double, val tip: Double)

/** 結帳（給 staffai 與顧客流程共用） */
fun collectPayment(state: GameState, c: com.dreamrestaurant.core.Customer): Payment {
    if (c.paid || c.departing || c.done) return Payment(0.0, 0.0)
    c.paid = true
    val party = max(1, c.partySize)
    val base = c.order.sumOf { it.price } *
        (B.TYPE_SPEND[c.type] ?: 1.0) * party * B.PARTY_PAY_FACTOR
    val value = if (c.order.isNotEmpty()) c.order.sumOf { it.value } / c.order.size else 1.0
    c.valueScore = value
    c.mood = clamp(c.mood + (value - 1) * 22, -100.0, 100.0)
    state.sim.todayValueScores.add(value)
    var tip = 0.0
    if (c.mood > B.MOOD_HAPPY) {
        tip = base * B.MOOD_MAX_TIP * (c.mood / 100)
        if (c.type == "vip") tip *= 1.6
        setBubble(c, "money", state, 2.5)
    }
    c.spent = round(base).toDouble()
    c.tip = round(tip).toDouble()
    state.cash += c.spent + c.tip
    state.stats.today.revenue += c.spent
    state.stats.today.tips += c.tip
    state.stats.today.served += party
    state.sim.servedLog.add(
        com.dreamrestaurant.core.ServedEntry(
            dishIds = c.order.map { it.dishId },
            spent = c.spent,
            mood = c.mood,
            party = party
        )
    )
    if (state.sim.servedLog.size > 200) state.sim.servedLog.removeAt(0)
    customerLeaves(state, c, null)
    return Payment(c.spent, c.tip)
}

/* -------------------------------------------------------------------- 廚房 */

fun enqueueKitchen(
    state: GameState,
    c: com.dreamrestaurant.core.Customer,
    table: TableState,
    item: com.dreamrestaurant.core.OrderLine
) {
    val skill = bestChefOnShift(state)
    val speed = 0.72 + (skill / 200.0)
    val broken = if (state.sim.equipBroken.stove) 2.1 else 1.0
    val stoveLvl = state.kitchen.stove.coerceAtLeast(1)
    val cookMinutes = max(
        1.5,
        item.cookTime * B.COOK_TIME_SCALE * (1 / speed) * broken * B.kitchenStoveMultiplier(stoveLvl)
    )
    state.sim.kitchen.add(
        KitchenJob(
            id = "k${state.day}_${kitchenSeq++}",
            dishId = item.dishId,
            tableUid = table.uid,
            customerUid = c.uid,
            score = item.score,
            remaining = cookMinutes,
            total = cookMinutes,
            chefUid = null,
            started = false
        )
    )
}

fun bestChefOnShift(state: GameState): Int {
    val chefs = state.staff.filter { it.role == "chef" && it.working }
    if (chefs.isEmpty()) return 30
    return chefs.maxOf { it.skill }
}

fun updateChef(state: GameState, st: HiredStaff, dtMin: Double) {
    val home = chefSlot(state, st)
    st.x = home.x; st.y = home.y
    st.frame = (st.frame + dtMin * 1.5) % 2

    val potsPerChef = B.kitchenPrepPots(state.kitchen.prep.coerceAtLeast(1))
    val mine = state.sim.kitchen.filter { it.chefUid == st.uid }.toMutableList()
    for (job in mine) job.started = true
    while (mine.size < potsPerChef) {
        val free = state.sim.kitchen.firstOrNull { it.chefUid == null } ?: break
        free.chefUid = st.uid
        free.started = true
        mine.add(free)
    }
    if (mine.isEmpty()) {
        st.state = "idle"
        return
    }
    st.state = "cooking"

    val brokenMod = if (state.sim.equipBroken.stove) 0.6 else 1.0
    val stoveMul = B.kitchenStoveMultiplier(state.kitchen.stove.coerceAtLeast(1))
    val speedMod = (0.75 + st.skill / 200.0) * st.speedMod * brokenMod * stoveMul
    val done = mutableListOf<KitchenJob>()
    for (job in mine) {
        job.remaining -= dtMin * speedMod
        if (job.remaining <= 0) {
            job.remaining = 0.0
            done.add(job)
        }
    }
    for (job in done) {
        val c = state.sim.customers.firstOrNull { it.uid == job.customerUid }
        state.sim.kitchen = state.sim.kitchen.filter { it.id != job.id }.toMutableList()
        if (c != null && (c.state == "waitingFood" || c.state == "ordering")) {
            state.sim.pass.add(
                PassItem(
                    id = job.id,
                    dishId = job.dishId,
                    tableUid = job.tableUid,
                    customerUid = job.customerUid,
                    score = job.score,
                    remaining = job.remaining,
                    total = job.total,
                    chefUid = job.chefUid,
                    started = job.started,
                    readyAt = state.minute.toDouble(),
                    pickedUp = false
                )
            )
            createTask(state, "deliver", tableUid = job.tableUid, customerUid = job.customerUid)
        }
    }
}

private fun releaseChef(state: GameState, st: HiredStaff) {
    for (job in state.sim.kitchen) {
        if (job.chefUid == st.uid) {
            job.chefUid = null
            job.started = false
        }
    }
}

/* --------------------------------------------------------------- 離職判定 */

fun checkResignations(state: GameState, rng: Rng): List<HiredStaff> {
    val quitters = mutableListOf<HiredStaff>()
    val chefCount = state.staff.count { it.role == "chef" }
    for (st in state.staff) {
        if (st.role == "chef" && chefCount <= 1) continue
        if (st.mood < B.MOOD_QUIT && rng.chance(0.004)) quitters.add(st)
    }
    for (st in quitters) {
        state.staff = state.staff.filter { it.uid != st.uid }.toMutableList()
        cancelTasksFor(state) { t -> t.claimedBy == st.uid }
        pushLog(state, "${st.name} 因為心情太差離職了…", "bad")
        state.uiQueue.add(
            com.dreamrestaurant.core.UiMsg(
                type = "toast",
                message = "${st.name} 離職了！記得調薪或減少工時", kind = "bad"
            )
        )
    }
    return quitters
}
