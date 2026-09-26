package com.dreamrestaurant

import com.dreamrestaurant.core.B
import com.dreamrestaurant.core.GameAction
import com.dreamrestaurant.core.Rng
import com.dreamrestaurant.core.createNewGame
import com.dreamrestaurant.core.menuLimitFor
import com.dreamrestaurant.core.reduce
import com.dreamrestaurant.core.round
import com.dreamrestaurant.data.LOCATIONS
import com.dreamrestaurant.data.dishesForStars
import com.dreamrestaurant.sim.P
import com.dreamrestaurant.sim.defaultLayout
import com.dreamrestaurant.sim.isWalkableTile
import com.dreamrestaurant.sim.makeCustomer
import com.dreamrestaurant.sim.seatCount
import com.dreamrestaurant.sim.stepSimulation
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 對照 tests/smoke.mjs 的無 DOM 煙霧測試。
 * 驗證：模擬不變式（現金有限、評價在範圍內、顧客不卡死、任務不會爆量），
 *       並跑滿 N 天（含兩次週結算）。
 */
class SmokeTest {

    private val failures = mutableListOf<String>()
    private val dayLog = mutableListOf<Map<String, Any>>()

    private fun check(cond: Boolean, label: String, detail: String = "") {
        if (cond) return
        failures.add(if (detail.isEmpty()) label else "$label — $detail")
    }

    private fun finite(v: Double) = !v.isNaN() && !v.isInfinite()

    private val expansionTables = listOf(
        P(23, 6), P(3, 10), P(6, 10), P(20, 10),
        P(24, 6), P(24, 10), P(2, 12), P(4, 12),
        P(6, 12), P(8, 12)
    )

    @Test
    fun smoke() {
        val days = 14
        val seed = 20240101L
        val state = createNewGame(seed)

        println("=== 夢幻西餐廳 復刻版 · 模擬煙霧測試 ===")
        println("seed=$seed  天數=$days")
        println("起始地點：${com.dreamrestaurant.data.getLocation(state.locationId)?.name}  現金 NT$ ${String.format("%,d", state.cash.toLong())}")
        println("起始座位：${seatCount(state.sim.tables)}  菜單：${state.menu.size} 道  員工：${state.staff.size} 人")

        // 開放更多菜色，讓模擬有變化
        val extra = dishesForStars(state.stars)
            .filter { d -> state.menu.none { it.dishId == d.id } }
            .take(4)
        for (d in extra) reduce(state, GameAction.MenuAdd(d.id))

        var restockCount = 0
        var maxCustomersSeen = 0
        var maxTasksSeen = 0

        fun invariants(tag: String) {
            check(finite(state.cash), "$tag: 現金必須是有限數", state.cash.toString())
            check(state.reputation.community >= 0 && state.reputation.community <= 500,
                "$tag: 社區評價需在 0..500", state.reputation.community.toString())
            check(state.reputation.outside >= 0 && state.reputation.outside <= 500,
                "$tag: 區外評價需在 0..500", state.reputation.outside.toString())
            check(state.minute >= 0 && state.minute < 1440, "$tag: 時間需在 0..1439", state.minute.toString())
            check(state.day >= 1, "$tag: 天數需 >= 1")
            check(state.stars in 1..B.MAX_STARS, "$tag: 星級需在 1..${B.MAX_STARS}", state.stars.toString())
            check(state.sim.customers.size <= 400, "$tag: 顧客人數異常", state.sim.customers.size.toString())
            check(state.sim.tasks.size <= 400, "$tag: 任務數量異常", state.sim.tasks.size.toString())
            check(state.staff.all { finite(it.wage.toDouble()) && it.wage >= 1 }, "$tag: 員工時薪異常")
            for (c in state.sim.customers) {
                if (!finite(c.x) || !finite(c.y)) {
                    check(false, "$tag: 顧客座標必須有限", "${c.uid} (${c.x},${c.y})")
                    break
                }
            }
            maxCustomersSeen = maxOf(maxCustomersSeen, state.sim.customers.size)
            maxTasksSeen = maxOf(maxTasksSeen, state.sim.tasks.size)
            val tids = state.sim.tasks.joinToString(",") {
                "${it.id}:${it.kind}:${it.stage ?: "-"}:${it.claimedBy ?: "-"}:${it.cleanTarget ?: it.tableUid ?: "-"}"
            }
            val staffS = state.staff.joinToString(" ") {
                "${it.role}/${it.state}/${it.task ?: "-"}/${String.format(java.util.Locale.US, "%.3f", it.x)},${String.format(java.util.Locale.US, "%.3f", it.y)}/${it.pathIndex}/${it.path.size}"
            }
            val cmood = state.sim.customers.sumOf { it.mood }
            val dishScores = state.sim.todayDishScores
            println(
                "M d=${state.day} m=${state.minute.toInt()} repC=${String.format(java.util.Locale.US, "%.6f", state.reputation.community)} " +
                    "repO=${String.format(java.util.Locale.US, "%.6f", state.reputation.outside)} cust=${state.sim.customers.size} " +
                    "served=${state.stats.today.served} angry=${state.stats.today.angry} guests=${state.stats.today.guests} " +
                    "tasks=${state.sim.tasks.size} moodSum=${String.format(java.util.Locale.US, "%.6f", state.stats.today.moodSum)} " +
                    "moodCount=${state.stats.today.moodCount} waitSum=${String.format(java.util.Locale.US, "%.6f", state.stats.today.waitSum)} " +
                    "cmood=${String.format(java.util.Locale.US, "%.6f", cmood)} dishN=${dishScores.size} " +
                    "dishSum=${String.format(java.util.Locale.US, "%.6f", dishScores.sum())} " +
                    "dirtF=${String.format(java.util.Locale.US, "%.6f", state.sim.dirt.floor)} " +
                    "dirtR=${String.format(java.util.Locale.US, "%.6f", state.sim.dirt.restroom)} rng=${state.rng} tids=[$tids] staff=[$staffS]"
            )
        }

        var totalGuests = 0
        var totalRevenue = 0
        var totalAngry = 0

        /** 模擬一位「稱職的老闆」：修繕、清潔、叫貨、擴桌、補人、買防護設備 */
        fun morningRoutine(day: Int) {
            for (target in listOf("ac", "stove", "fridge")) {
                val broken = when (target) {
                    "ac" -> state.sim.equipBroken.ac
                    "stove" -> state.sim.equipBroken.stove
                    else -> state.sim.equipBroken.fridge
                }
                if (broken) reduce(state, GameAction.Repair(target = target))
            }
            for (item in state.layout.items.toList()) {
                if (item.broken || item.durability < 55) reduce(state, GameAction.Repair(uid = item.uid))
            }
            if (state.sim.dirt.restroom > 55) reduce(state, GameAction.Clean(target = "restroom"))
            if (state.sim.dirt.floor > 65) reduce(state, GameAction.Clean(target = "floor"))

            // 叫貨
            for (entry in state.menu.filter { it.active }) {
                val have = state.stock[entry.dishId] ?: 0
                val incoming = state.suppliers.filter { it.dishId == entry.dishId }.sumOf { it.servings }
                if (have + incoming < 50) {
                    val res = reduce(state, GameAction.BuyStock(entry.dishId, 60))
                    if (res.ok) restockCount += 1
                }
            }

            // 開幕大補帖：防護設備與裝飾
            if (day == 1) {
                for (id in listOf(
                    "cctv", "infrared_sensor", "fire_system", "security_host", "fire_extinguisher",
                    "fridge", "ceiling_lamp", "stereo", "painting_landscape",
                    "wooden_screen", "flower_stand", "aquarium"
                )) {
                    reduce(state, GameAction.PlaceFurniture(id, -1, -1))
                }
            }

            // 隨生意成長擴桌
            val tableCount = state.layout.items.count { it.typeId.startsWith("table_") }
            if (tableCount < 9 && state.cash > 120000) {
                val t = expansionTables.getOrNull(tableCount - 2)
                val order = listOf("table_4a", "table_6a", "table_4a", "table_2a", "table_6a", "table_4a", "table_4a")
                val typeId = order[tableCount % order.size]
                if (t != null) {
                    val res = reduce(state, GameAction.PlaceFurniture(typeId, t.x.toInt(), t.y.toInt()))
                    if (res.ok) {
                        for ((dx, dy) in listOf(0 to -1, 0 to 1, -1 to 0, 1 to 0)) {
                            reduce(state, GameAction.PlaceFurniture("chair_wood", t.x.toInt() + dx, t.y.toInt() + dy))
                        }
                    }
                }
            }

            // 補人
            if (state.staff.size < 12 && state.cash > 80000 && state.candidates.isNotEmpty()) {
                reduce(state, GameAction.Hire(state.candidates[0].candidateId))
            }
            // 加菜
            val wantDishes = minOf(menuLimitFor(state.stars), 4 + day)
            if (state.menu.size < wantDishes) {
                val pool = dishesForStars(state.stars).filter { d -> state.menu.none { it.dishId == d.id } }
                if (pool.isNotEmpty()) {
                    val loc = state.locationId
                    val pick = pool.maxByOrNull { it.popularity[loc] ?: 1.0 } ?: pool[0]
                    reduce(state, GameAction.MenuAdd(pick.id))
                }
            }
            // 有錢就提升材料等級（口味分數的主要來源）＋ 買裝飾
            if (state.cash > 200000) {
                for (entry in state.menu.filter { it.active }) {
                    if (entry.grade < 88) {
                        reduce(
                            state,
                            GameAction.MenuUpdate(entry.dishId, com.dreamrestaurant.core.MenuPatch(grade = minOf(90, entry.grade + 4)))
                        )
                    }
                }
                for (id in listOf("painting_landscape", "flower_stand", "aquarium", "wooden_screen", "carpet_red", "lantern_row")) {
                    reduce(state, GameAction.PlaceFurniture(id, -1, -1))
                }
            }
            // 士氣管理
            val waiters = state.staff.filter { it.role == "waiter" }
            waiters.forEachIndexed { i, st ->
                reduce(state, GameAction.SetShift(st.uid, 600, 1380))
                reduce(state, GameAction.SetDuty(st.uid, "cleanFloor", true))
                reduce(state, GameAction.SetDuty(st.uid, "cleanRestroom", true))
                if (i == 0) reduce(state, GameAction.SetDuty(st.uid, "cashier", true))
                if (st.mood < 45) reduce(state, GameAction.SetWage(st.uid, maxOf(3, st.wage + 1)))
            }
            for (st in state.staff.filter { it.role == "chef" }) {
                reduce(state, GameAction.SetShift(st.uid, 600, 1380))
                if (st.mood < 45) reduce(state, GameAction.SetWage(st.uid, maxOf(3, st.wage + 1)))
            }
        }

        fun dumpDayStart() {
            fun f(x: Double, n: Int = 6) = String.format(java.util.Locale.US, "%.${n}f", x)
            println(
                "D day=${state.day} repC=${f(state.reputation.community)} repO=${f(state.reputation.outside)} fame=${f(state.fame)} stars=${state.stars} " +
                    "cash=${f(state.cash, 2)} weather=${state.sim.weather} traffic=${f(state.sim.trafficMul)} spawnAcc=${f(state.sim.spawnAccumulator)} " +
                    "spawn=${state.sim.customersSpawned} evT=${f(state.sim.eventTimer, 4)} menu=${state.menu.size} staff=${state.staff.size} " +
                    "dec=${state.stats.today.decorations} supplier=${f(state.sim.supplierPriceMul)} activeEv=${state.sim.activeEvents.size} rng=${state.rng}"
            )
        }

        // 開局佈置：桌椅、裝飾、人手
        for (p in listOf(P(3, 10), P(20, 10))) {
            val res = reduce(state, GameAction.PlaceFurniture("table_2a", p.x.toInt(), p.y.toInt()))
            if (!res.ok) println("  (擺設略過 table_2a@${p.x},${p.y}: ${res.error})")
        }
        for (cand in state.candidates.take(3)) {
            val res = reduce(state, GameAction.Hire(cand.candidateId))
            if (!res.ok) break
        }

        for (d in 0 until days) {
            morningRoutine(d + 1)
            val open = reduce(state, GameAction.StartDay)
            if (!open.ok) {
                check(false, "第 ${state.day} 天無法開店", open.error ?: "")
                reduce(state, GameAction.PlaceFurniture("table_2a", 3, 10))
                val retry = reduce(state, GameAction.StartDay)
                if (!retry.ok) break
            }
            dumpDayStart()

            var guard = 0
            val startDay = state.day
            while (state.phase == "open" || state.phase == "closing") {
                stepSimulation(state, 5.0)
                guard += 1
                if (guard % 6 == 0) {
                    invariants("第 ${startDay} 天 / ${state.minute / 60}:${state.minute % 60}")
                    if (guard % 96 == 0) morningRoutine(startDay)
                }
                if (guard > 1200) {
                    check(false, "第 $startDay 天無法結束（顧客卡住）",
                        "customers=${state.sim.customers.size} phase=${state.phase}")
                    break
                }
            }
            invariants("第 $startDay 天結束")

            val rec = state.stats.history.lastOrNull()
            if (rec != null && rec.day == startDay) {
                totalGuests += rec.guests
                totalRevenue += rec.revenue
                totalAngry += rec.angry
                dayLog.add(
                    mapOf(
                        "avgWait" to rec.avgWaitSec, "day" to rec.day, "guests" to rec.guests,
                        "served" to rec.served, "angry" to rec.angry, "revenue" to rec.revenue,
                        "profit" to rec.profit, "repC" to rec.repCommunity, "repO" to rec.repOutside,
                        "stars" to rec.stars, "parties" to rec.parties
                    )
                )
            }

            state.uiQueue.clear()

            if (d < days - 1) {
                val next = reduce(state, GameAction.NextDay)
                if (!next.ok) {
                    check(false, "無法進入隔天", next.error ?: "")
                    break
                }
            }
        }

        /* ---------------------------------------------------------- 結果輸出 */
        fun pad(v: Any?, n: Int): String {
            val t = v.toString()
            return if (t.length >= n) t else " ".repeat(n - t.length) + t
        }

        fun numText(v: Double): String =
            if (v.isFinite() && v == kotlin.math.floor(v) && kotlin.math.abs(v) < 1e15) v.toLong().toString()
            else v.toString()

        println("\n--- 逐日結果 ---")
        println("天  來客  服務  生氣   營業額      淨利      社區   區外  星")
        for (r in dayLog) {
            println(
                "${pad(r["day"], 2)}  ${pad(r["guests"], 4)}  ${pad(r["served"], 4)}  ${pad(r["angry"], 4)}  " +
                    "${pad(r["revenue"], 9)}  ${pad(r["profit"], 9)}  ${pad(round(r["repC"] as Double).toInt(), 5)}  " +
                    "${pad(round(r["repO"] as Double).toInt(), 5)}  ${r["stars"]}"
            )
        }

        println("\n--- 總計 ---")
        println("天數        : ${state.day}")
        println("總來客      : $totalGuests")
        println("總營業額    : NT$ ${String.format("%,d", totalRevenue)}")
        println("總生氣離開  : $totalAngry")
        println("目前現金    : NT$ ${String.format("%,d", Math.round(state.cash))}")
        println("星級        : ${state.stars}")
        println("評價(社區/區外): ${round(state.reputation.community).toInt()} / ${round(state.reputation.outside).toInt()}")
        println("週結算次數  : ${state.stats.weekly.size}")
        if (state.stats.weekly.isNotEmpty()) {
            val w = state.stats.weekly.last()
            val waits = dayLog.map { (it["avgWait"] as Number).toDouble() }.filter { it > 0 }
            val rates = dayLog.map { (it["angry"] as Number).toDouble() / (it["guests"] as Number).toDouble() }
            if (waits.isNotEmpty()) {
                val avgWaitMin = Math.round(waits.sum() / waits.size / 60.0)
                val perParty = dayLog.sumOf { (it["guests"] as Number).toDouble() / (it["parties"] as Number).toDouble() } / dayLog.size
                println(
                    "平均等待    : $avgWaitMin 分  ｜ 生氣率 ${String.format(java.util.Locale.US, "%.1f", rates.sum() / rates.size * 100)}%" +
                        "  ｜ 平均每組 ${String.format(java.util.Locale.US, "%.1f", perParty)} 人"
                )
            }
            println("最近週排名  : 總第 ${w.totalRank} 名（口味 ${w.ranks["taste"]} / 服務 ${w.ranks["service"]} / 裝潢 ${w.ranks["decor"]} / 價格 ${w.ranks["price"]} / 人氣 ${w.ranks["popularity"]}）")
        }
        println("進貨次數    : $restockCount")
        println("店面規模    : ${state.layout.items.count { it.typeId.startsWith("table_") }} 張桌 ／ ${seatCount(state.sim.tables)} 個可用座位 ／ 裝潢 ${state.layout.items.size} 件")
        println("員工        : 服務生 ${state.staff.count { it.role == "waiter" }} 人、廚師 ${state.staff.count { it.role == "chef" }} 人")
        println("最大同時顧客: $maxCustomersSeen")
        println("最大任務數  : $maxTasksSeen")

        println("\n--- 週結算摘要 ---")
        println("週  期間        總排名  口味 服務 裝潢 價格 人氣  星  獎金")
        for (w in state.stats.weekly) {
            println(
                "${pad(w.week, 2)}  d${w.startDay}-${w.endDay}  ${pad(w.totalRank, 5)}  " +
                    "${pad(w.ranks["taste"], 4)} ${pad(w.ranks["service"], 4)} ${pad(w.ranks["decor"], 4)} " +
                    "${pad(w.ranks["price"], 4)} ${pad(w.ranks["popularity"], 4)}  ${w.stars}  ${w.prize}"
            )
        }
        val lastWeekly = state.stats.weekly.lastOrNull()
        val sc = lastWeekly?.scores
        if (sc == null || sc.isEmpty()) {
            println("分數: {}")
        } else {
            val ordered = listOf("taste", "service", "decor", "price", "popularity").filter { sc.containsKey(it) }
            println("分數: {" + ordered.joinToString(",") { "\"$it\":${numText(sc.getValue(it))}" } + "}")
        }

        println("\n--- 常連 Cherish ---")

        /* -------------------------------------------------- 地點與星級資料不變式 */
        println("\n--- Location / star data ---")
        val ids = LOCATIONS.map { it.id }
        check(LOCATIONS.size >= 14, "at least 14 locations", LOCATIONS.size.toString())
        check(ids.toSet().size == ids.size, "location ids are unique", ids.joinToString(","))
        check(
            LOCATIONS[0].id == "zhongli_xinming" && LOCATIONS[0].starsRequired == 1,
            "the original starting location is still first and playable"
        )

        val mixKeys = listOf("student", "office", "family", "tourist", "critic", "vip")
        val weatherKeys = listOf("sunny", "cloudy", "rain", "storm", "cold", "heat")
        for (loc in LOCATIONS) {
            val errs = mutableListOf<String>()
            if (loc.name.isEmpty() || loc.city.isEmpty() || loc.desc.isEmpty()) errs.add("missing name/city/desc")
            if (loc.rentPerDay <= 0) errs.add("rentPerDay")
            if (loc.baseTraffic <= 0) errs.add("baseTraffic")
            if (loc.moveCost < 0) errs.add("moveCost")
            if (loc.gridW < 4 || loc.gridH < 4) errs.add("grid")
            if (loc.starsRequired < 1 || loc.starsRequired > B.MAX_STARS) errs.add("starsRequired")
            val mixSum = mixKeys.sumOf { loc.customerMix[it] ?: 0.0 }
            if (kotlin.math.abs(mixSum - 1.0) > 1e-9) errs.add("customerMix sum $mixSum")
            val wSum = weatherKeys.sumOf { loc.weatherWeights[it] ?: 0.0 }
            if (kotlin.math.abs(wSum - 1.0) > 1e-9) errs.add("weatherWeights sum $wSum")
            if (loc.tastePrefs.isEmpty()) errs.add("tastePrefs")
            if (loc.decorStyle.isEmpty() || loc.skyline.isEmpty()) errs.add("decorStyle/skyline")
            if (loc.palette["sky"] == null || loc.palette["wall"] == null ||
                loc.palette["floor"] == null || loc.palette["accent"] == null
            ) errs.add("palette")
            check(errs.isEmpty(), "location field check: ${loc.id}", errs.joinToString(" / "))

            val L = defaultLayout(loc.id)
            val layoutErrs = mutableListOf<String>()
            if (L.gridW != loc.gridW || L.gridH != loc.gridH) layoutErrs.add("grid mismatch")
            val door = L.door
            if (L.tiles[door.y.toInt() * L.gridW + door.x.toInt()] != "door") layoutErrs.add("door tile")
            if (L.passTiles.isEmpty()) layoutErrs.add("no pass tile")
            if (!isWalkableTile(L, door.x.toInt(), door.y.toInt())) layoutErrs.add("door not walkable")
            if (!isWalkableTile(L, door.x.toInt(), door.y.toInt() - 1)) layoutErrs.add("tile inside the door blocked")
            for (p in L.passTiles) {
                val px = p.x.toInt()
                val py = p.y.toInt()
                if (!isWalkableTile(L, px, py)) layoutErrs.add("pass blocked @$px,$py")
                else if ((L.reachFromPass?.getOrNull(py * L.gridW + px) ?: 0) == 0) layoutErrs.add("pass unreachable @$px,$py")
            }
            val seatsFree = L.tiles.filterIndexed { i, t ->
                t == "floor" && isWalkableTile(L, i % L.gridW, i / L.gridW)
            }.size
            if (seatsFree < 40) layoutErrs.add("only $seatsFree walkable floor tiles")
            check(layoutErrs.isEmpty(), "layout check: ${loc.id}", layoutErrs.joinToString(" / "))
        }

        check(B.STAR_REQS.size == B.MAX_STARS + 1, "STAR_REQS has ${B.MAX_STARS + 1} entries", B.STAR_REQS.size.toString())
        for (s in 2..B.MAX_STARS) {
            val prev = B.STAR_REQS[s - 1]
            val cur = B.STAR_REQS[s]
            check(cur.star == s, "STAR_REQS[$s].star === $s")
            check(cur.community > prev.community, "community grows at $s star", "${prev.community} -> ${cur.community}")
            check(cur.outside > prev.outside, "outside grows at $s star", "${prev.outside} -> ${cur.outside}")
            check(cur.days >= prev.days, "days never shrink at $s star", "${prev.days} -> ${cur.days}")
            check(cur.community <= 500 && cur.outside <= 500, "star $s thresholds within the 0..500 rating range")
            check(
                menuLimitFor(s) >= menuLimitFor(s - 1),
                "menu limit never shrinks at $s star",
                "${menuLimitFor(s - 1)} -> ${menuLimitFor(s)}"
            )
        }
        check(LOCATIONS.count { it.starsRequired == B.MAX_STARS } > 0, "at least one location is gated behind the top star")

        /* ---------------------------------------------------------- 最終不變式 */
        println("\n--- 驗收檢查 ---")
        check(state.stats.history.size == days, "應產生 $days 筆日報表", state.stats.history.size.toString())
        check(totalGuests > 0, "應該要有客人上門")
        check(state.stats.weekly.size == days / 7, "每 7 天要有一次週結算", state.stats.weekly.size.toString())
        check(state.reputation.community != 350.0 || state.day > 1, "評價應該要有變化")
        check(state.stats.history.all { finite(it.profit.toDouble()) && finite(it.revenue.toDouble()) }, "日報表數值必須有限")
        check(state.staff.all { it.hoursToday >= 0 }, "工時不得為負")
        check(state.menu.size <= 99, "菜單數量合理")
        val badDays = state.stats.history.filter { (it.served + it.angry) > it.guests + 1 }
        check(
            badDays.isEmpty(),
            "服務＋生氣不得超過來客數",
            badDays.take(3).joinToString(" / ") { "d${it.day}: 人${it.guests} 服務${it.served} 生氣${it.angry}" }
        )

        val arrived = state.menu.any { (state.stock[it.dishId] ?: 0) > 0 }
        check(arrived, "庫存應該要有貨")

        if (failures.isNotEmpty()) {
            println("\n煙霧測試失敗：${failures.size} 項")
            for (f in failures) println("  ✗ $f")
        } else {
            println("\n✅ 煙霧測試全數通過")
        }
        assertTrue("煙霧測試失敗：${failures.size} 項\n${failures.joinToString("\n")}", failures.isEmpty())
    }

    /* --------------------------------------------- 常連 Cherish（特別客層） */

    @Test
    fun cherishCustomer() {
        val failures = mutableListOf<String>()
        fun check(cond: Boolean, label: String, detail: String = "") {
            if (!cond) failures.add(if (detail.isEmpty()) label else "$label — $detail")
        }

        val s2 = createNewGame(20240101L + 7)
        val rng2 = Rng(4242)
        val cher = makeCustomer(s2, rng2, "cherish")
        check(cher.type == "cherish", "指定客層可以建立 Cherish", cher.type)
        check(cher.partySize == 1, "Cherish 一定是一個人來", cher.partySize.toString())
        check(cher.appearance.sheet == "cherish", "外觀帶有 sprite sheet 標記", cher.appearance.sheet ?: "null")
        var seen = 0
        for (i in 0 until 5000) {
            val c = makeCustomer(s2, rng2)
            if (c.type == "cherish") seen++
        }
        check(seen > 0, "一般抽選也會出現 Cherish", "$seen / 5000 組")
        check(finite(cher.patience) && cher.patience > 0, "耐心值有效", cher.patience.toInt().toString())

        if (failures.isNotEmpty()) for (f in failures) println("  ✗ $f")
        assertTrue("Cherish 檢查失敗\n${failures.joinToString("\n")}", failures.isEmpty())
    }

    /* ---------------------------------------------------------- 存讀檔往返 */

    @Test
    fun saveLoadRoundTrip() {
        val state = createNewGame(20240101L)
        reduce(state, GameAction.PlaceFurniture("table_2a", 3, 10))
        reduce(state, GameAction.MenuAdd(dishesForStars(1).first().id))

        val json = com.dreamrestaurant.core.serialize(state)
        val restored = com.dreamrestaurant.core.deserialize(json)
        assertTrue("反序列化不得為 null", restored != null)
        val r = restored!!

        assertTrue("day 相同", r.day == state.day)
        assertTrue("cash 相同", r.cash == state.cash)
        assertTrue("rng 相同", r.rng == state.rng)
        assertTrue("seed 相同", r.seed == state.seed)
        assertTrue("menu 筆數相同", r.menu.size == state.menu.size)
        assertTrue("menu 內容相同", r.menu.map { it.dishId to it.price } == state.menu.map { it.dishId to it.price })
        assertTrue("items 數量相同", r.layout.items.size == state.layout.items.size)
        assertTrue("items uid 相同", r.layout.items.map { it.uid } == state.layout.items.map { it.uid })
        assertTrue("tiles 相同", r.layout.tiles == state.layout.tiles)
        assertTrue("staff 數量相同", r.staff.size == state.staff.size)
        assertTrue("candidates 數量相同", r.candidates.size == state.candidates.size)
        assertTrue("reputation 相同", r.reputation.community == state.reputation.community)
        assertTrue("layout.rev 相同", r.layout.rev == state.layout.rev)
        assertTrue("座位數相同", seatCount(r.sim.tables) == seatCount(state.sim.tables))
        assertTrue("reach 已重建", r.layout.reach != null)
    }
}
