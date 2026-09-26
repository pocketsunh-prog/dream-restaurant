package com.dreamrestaurant.core

import com.dreamrestaurant.data.Candidate
import com.dreamrestaurant.data.Dish
import com.dreamrestaurant.data.FurnitureDef
import com.dreamrestaurant.data.LocationDef
import com.dreamrestaurant.data.StaffDef
import com.dreamrestaurant.data.furnitureById
import com.dreamrestaurant.data.getLocation
import com.dreamrestaurant.data.makeCandidateList
import com.dreamrestaurant.sim.Layout
import com.dreamrestaurant.sim.P
import com.dreamrestaurant.sim.PathEntity
import com.dreamrestaurant.sim.Seat
import com.dreamrestaurant.sim.TableState
import com.dreamrestaurant.sim.autoPlaceChairs
import com.dreamrestaurant.sim.defaultLayout
import com.dreamrestaurant.sim.findAutoPlace
import com.dreamrestaurant.sim.rebuildTables
import com.dreamrestaurant.sim.syncFootprints
import kotlin.math.max
import kotlin.math.min
import com.dreamrestaurant.core.round

const val SAVE_VERSION = 4

/* --------------------------------------------------------------- 狀態模型 */

class Appearance(
    var hair: String = "#2b1b12",
    var skin: String = "#f0c9a0",
    var shirt: String = "#3a6ea5",
    var hat: Int = 0,
    var sheet: String? = null,
    var name: String? = null
)

class Rep(var community: Double = B.RATING_START.toDouble(), var outside: Double = B.RATING_START.toDouble())

class FxFlags(
    var pools: Boolean = true,
    var shadows: Boolean = false,
    var ao: Boolean = false,
    var vignette: Boolean = false,
    var outsideShade: Boolean = false,
    var shafts: Boolean = false
)

class Settings {
    var fx: FxFlags = FxFlags()
    var openMinute: Int = 11 * 60
    var closeMinute: Int = 23 * 60
    var acTemp: Int = 24
    var music: String = "lazy"
    var openDays: MutableList<Boolean> = MutableList(7) { true }
    var wallColor: String = "#c9a26b"
    var floorColor: String = "#8c6a44"
    var wallMat: String? = null
    var floorMat: String? = null
}

class MenuEntry(
    var dishId: String,
    var price: Int,
    var grade: Int,
    var taste: Int,
    var portion: Int,
    var cookTime: Int,
    var active: Boolean = true,
    var sold: Int = 0
)

class Supplier(var dishId: String, var servings: Int, var arriveMinute: Double, var cost: Int)

class Duties(
    var escort: Boolean = true,
    var serve: Boolean = true,
    var order: Boolean = true,
    var bus: Boolean = true,
    var cleanRestroom: Boolean = false,
    var cleanFloor: Boolean = false,
    var cashier: Boolean = false
)

class Shift(var start: Int = 10 * 60, var end: Int = 23 * 60)

class HiredStaff(
    var uid: String,
    var staffId: String,
    var name: String,
    var role: String,
    var wage: Int,
    var hireDay: Int,
    var shift: Shift = Shift(),
    var duties: Duties = Duties(),
    var fatigue: Double = 0.0,
    var mood: Double = 70.0,
    var specialty: String = "all",
    var speedMod: Double = 1.0,
    var working: Boolean = false,
    var hoursToday: Double = 0.0,
    override var x: Double = 0.0,
    override var y: Double = 0.0,
    override var dir: String = "S",
    override var frame: Double = 0.0,
    override var path: MutableList<P> = mutableListOf(),
    override var pathIndex: Int = 0,
    var task: String? = null,
    var state: String = "idle",
    var restTimer: Double = 0.0,
    var appearance: Appearance = Appearance(),
    var skill: Int = 50,
    var speed: Int = 50
) : PathEntity

class Customer(
    var uid: String,
    var type: String,
    var appearance: Appearance = Appearance(),
    var mood: Double = 0.0,
    var patience: Double = 60.0,
    var budget: Double = 0.0,
    var partySize: Int = 1,
    override var x: Double = 0.0,
    override var y: Double = 0.0,
    override var dir: String = "N",
    override var frame: Double = 0.0,
    override var path: MutableList<P> = mutableListOf(),
    override var pathIndex: Int = 0,
    var state: String = "arriving",
    var tableUid: String? = null,
    var seat: P? = null,
    var seatedDir: String = "S",
    var enterMinute: Double = 0.0,
    var seatMinute: Double? = null,
    var orderMinute: Double? = null,
    var firstFoodMinute: Double? = null,
    var eatDoneMinute: Double? = null,
    var waitMin: Double = 0.0,
    var order: MutableList<OrderLine> = mutableListOf(),
    var dishScoreAvg: Double = 0.0,
    var valueScore: Double = 1.0,
    var spent: Double = 0.0,
    var tip: Double = 0.0,
    var leftAngry: Boolean = false,
    var wasCritic: Boolean = false,
    var outsideRoll: Boolean = false,
    var bubble: String? = null,
    var bubbleKind: String? = null,
    var bubbleUntil: Double = 0.0,
    var prefTaste: Double = 55.0,
    var prefTags: List<String> = emptyList(),
    var queueSpot: P? = null,
    var queueIndex: Int = 0,
    var memberLooks: MutableList<Appearance> = mutableListOf(),
    var seatIndices: MutableList<Int> = mutableListOf(),
    var members: MutableList<Member> = mutableListOf(),
    var complained: Boolean = false,
    var departing: Boolean = false,
    var done: Boolean = false,
    var leaveReason: String? = null,
    var leaveMinute: Double = 0.0,
    var queueTarget: P? = null,
    var tableUidOrig: String? = null,
    var seatIndicesOrig: MutableList<Int>? = null,
    var selfSeated: Boolean = false,
    var selfPayAt: Double? = null,
    var paid: Boolean = false,
    var partyVoice: Double? = null,
    var ratingBucket: String? = null,
    var ratingDelta: Double = 0.0
) : PathEntity

class Member(var seat: P, var dir: String, var appearance: Appearance, var eating: Boolean = false, var frame: Int = 0)

class OrderLine(
    var dishId: String,
    var price: Int,
    var cookTime: Int,
    var grade: Int,
    var taste: Int,
    var portion: Int,
    var score: Double,
    var value: Double,
    var ready: Boolean = false,
    var delivered: Boolean = false
)

class Walker(
    var uid: String,
    var x: Double,
    var y: Double,
    var dir: String,
    var dx: Int,
    var speed: Double,
    var frame: Double,
    var type: String,
    var appearance: Appearance,
    var life: Double
)

class Task(
    var id: String,
    var kind: String,
    var createdMinute: Double,
    var claimedBy: String? = null,
    var tableUid: String? = null,
    var customerUid: String? = null,
    var cleanTarget: String? = null,
    var seatIndex: Int? = null,
    var seatIndices: MutableList<Int>? = null,
    var stage: String? = null,
    var waitingForSeat: Int = 0,
    var failed: Int = 0,
    var delay: Int? = null
)

class KitchenJob(
    var id: String,
    var dishId: String,
    var tableUid: String,
    var customerUid: String,
    var score: Double,
    var remaining: Double,
    var total: Double,
    var chefUid: String? = null,
    var started: Boolean = false
)

class PassItem(
    var id: String,
    var dishId: String,
    var tableUid: String,
    var customerUid: String,
    var score: Double,
    var remaining: Double,
    var total: Double,
    var chefUid: String? = null,
    var started: Boolean = false,
    var readyAt: Double = 0.0,
    var pickedUp: Boolean = false
)

class ActiveEvent(var eventId: String, var name: String, var until: Double, var trafficMul: Double)

class Dirt(var floor: Double = 0.0, var restroom: Double = 0.0)
class EquipBroken(var ac: Boolean = false, var stove: Boolean = false, var fridge: Boolean = false)
class KitchenLevels(var stove: Int = 1, var fridge: Int = 1, var prep: Int = 1)

class Complaint(var reason: String, var type: String, var day: Int, var minute: Int, var mood: Int, var wait: Int)
class ServedEntry(var dishIds: List<String>, var spent: Double, var mood: Double, var party: Int)
class VisitEntry(
    var type: String, var enter: Double, var seat: Double?, var order: Double?, var food: Double?,
    var leave: Double, var reason: String, var mood: Int, var spent: Double, var dishes: Int, var partySize: Int
)

class TodayStat {
    var revenue: Double = 0.0; var spend: Double = 0.0; var tips: Double = 0.0
    var wages: Double = 0.0; var rent: Double = 0.0; var utilities: Int = 0
    var inventory: Double = 0.0; var repairs: Double = 0.0
    var guests: Int = 0; var parties: Int = 0; var served: Int = 0; var angry: Int = 0
    var noBigTable: Int = 0; var waitSum: Double = 0.0; var waitCount: Int = 0
    var moodSum: Double = 0.0; var moodCount: Int = 0
    var complaints: MutableMap<String, Int> = mutableMapOf()
    var weather: String = "sunny"
    var decorations: Int = 0
}

class DailyRecord(
    var day: Int, var locationId: String, var weather: String,
    var revenue: Int, var tips: Int, var spend: Int, var profit: Int, var inventory: Int,
    var wages: Int, var rent: Int, var utilities: Int, var repairs: Int,
    var guests: Int, var parties: Int, var served: Int, var angry: Int,
    var avgWaitSec: Int, var avgMood: Double,
    var complaints: Map<String, Int>, var decor: Int,
    var repCommunity: Double, var repOutside: Double, var fame: Double, var stars: Int,
    var magazineRank: Int?, var dishScoreAvg: Double, var valueScoreAvg: Double
)

class MagEntry(var name: String, var score: Double, var me: Boolean = false, var rank: Int = 0)

class MagBoard(
    var rank: Int = 0,
    var score: Double = 0.0,
    var topList: MutableList<MagEntry> = mutableListOf(),
    var category: String = ""
)

class WeeklyRecord(
    var week: Int, var startDay: Int, var endDay: Int,
    var revenue: Int, var profit: Int, var guests: Int, var served: Int, var angry: Int,
    var scores: MutableMap<String, Double> = mutableMapOf(),
    var ranks: MutableMap<String, Int> = mutableMapOf(),
    var totalRank: Int, var prize: Int,
    var repCommunity: Double, var repOutside: Double, var stars: Int,
    var topList: MutableList<MagEntry> = mutableListOf()
)

class MagazineStat {
    var rank: MutableMap<String, MagBoard> = mutableMapOf()
    var lastSettleDay: Int = 0
    var lastTotalRank: Int? = null
    var bestTotalRank: Int? = null
    var firstPlaceWeeks: Int = 0
}

class Stats {
    var today: TodayStat = emptyToday()
    var history: MutableList<DailyRecord> = mutableListOf()
    var weekly: MutableList<WeeklyRecord> = mutableListOf()
    var magazine: MagazineStat = MagazineStat()
    var ratingsScore: MutableMap<String, Double> =
        mutableMapOf("taste" to 0.0, "service" to 0.0, "decor" to 0.0, "price" to 0.0, "popularity" to 0.0)
}

class Flags {
    var tutorialDone: Boolean = false
    var annualAward: Boolean = false
    var secretUnlocked: Boolean = false
    var warnedWeek: Int = 0
    var negativeCashDays: Double = 0.0
    var starHistory: MutableList<Int> = mutableListOf(1)
    var annualStartDay: Int = 0
    var lastAckSettleDay: Int = 0
}

class UiMsg(
    var type: String,
    var message: String = "",
    var kind: String = "info",
    var title: String = "",
    var notes: MutableList<String> = mutableListOf(),
    var from: Int = 0,
    var to: Int = 0,
    var locations: MutableList<String> = mutableListOf(),
    var week: Int = 0,
    var day: Int = 0,
    var record: DailyRecord? = null
)

class LogEntry(var day: Int, var minute: Int, var text: String, var kind: String)

class SimState {
    var customers: MutableList<Customer> = mutableListOf()
    var walkers: MutableList<Walker> = mutableListOf()
    var tables: MutableList<TableState> = mutableListOf()
    var tasks: MutableList<Task> = mutableListOf()
    var kitchen: MutableList<KitchenJob> = mutableListOf()
    var pass: MutableList<PassItem> = mutableListOf()
    var complaintLog: MutableList<Complaint> = mutableListOf()
    var servedLog: MutableList<ServedEntry> = mutableListOf()
    var visitLog: MutableList<VisitEntry> = mutableListOf()
    var lureBoost: Double = 0.0
    var lureDecayMinute: Double = 0.0
    var activeEvents: MutableList<ActiveEvent> = mutableListOf()
    var trafficMul: Double = 1.0
    var supplierPriceMul: Double = 1.0
    var supplierPriceMulUntil: Double = 0.0
    var dirt: Dirt = Dirt()
    var equipBroken: EquipBroken = EquipBroken()
    var spawnAccumulator: Double = 0.0
    var weather: String = "sunny"
    var eventTimer: Double = 180.0
    var todayDishScores: MutableList<Double> = mutableListOf()
    var todayValueScores: MutableList<Double> = mutableListOf()
    var todayMoods: MutableList<Double> = mutableListOf()
    var customersSpawned: Int = 0
    var customersLost: Int = 0
    var lureClicks: Int = 0
    var skippedBigParties: Int = 0
    var skippedBiggest: Int = 0
    var closingSoon: Boolean = false
    var lastOrderMinute: Int = 0
    var closingSince: Double? = null
    var forceType: String? = null
    var forceTypeLeft: Int = 0
}

class GameState {
    var version: Int = SAVE_VERSION
    var seed: Long = 1
    var rng: Long = 1
    var day: Int = 1
    var minute: Int = 540
    var minuteFloat: Double = 540.0
    var absMinute: Double = 540.0
    var speed: Int = 1
    var phase: String = "build"
    var locationId: String = "zhongli_xinming"
    var stars: Int = 1
    var fame: Double = 6.0
    var cash: Double = B.START_CASH.toDouble()
    var uidSeq: Int = 1
    var rev: Int = 0
    var menuLimit: Int = 8
    var absEatDone: Double? = null
    var reputation: Rep = Rep()
    var settings: Settings = Settings()
    var menu: MutableList<MenuEntry> = mutableListOf()
    var stock: MutableMap<String, Int> = mutableMapOf()
    var store: MutableMap<String, Int> = mutableMapOf()
    var suppliers: MutableList<Supplier> = mutableListOf()
    var staff: MutableList<HiredStaff> = mutableListOf()
    var candidates: MutableList<Candidate> = mutableListOf()
    var layout: Layout = Layout()
    var kitchen: KitchenLevels = KitchenLevels(5, 5, 5)
    var sim: SimState = SimState()
    var stats: Stats = Stats()
    var flags: Flags = Flags()
    var uiQueue: MutableList<UiMsg> = mutableListOf()
    var log: MutableList<LogEntry> = mutableListOf()
}

/* --------------------------------------------------------------- 建立狀態 */

fun nextUid(state: GameState): String {
    state.uidSeq = if (state.uidSeq >= 1) state.uidSeq + 1 else 2
    return "u${state.uidSeq}"
}

private fun cheapestStaff(role: String): StaffDef? {
    val pool = com.dreamrestaurant.data.STAFF_POOL.filter { it.role == role }
    if (pool.isEmpty()) return com.dreamrestaurant.data.STAFF_POOL.firstOrNull()
    return pool.minByOrNull { it.wage }
}

private val PREMIUM_STARTER = listOf(
    Triple("kitchen_stove", 1, 1), Triple("kitchen_worktable", 3, 1),
    Triple("kitchen_dishwasher", 5, 2), Triple("fridge", 6, 2),
    Triple("ac_unit", 0, 4), Triple("ceiling_lamp", 10, 0), Triple("stereo", 15, 0),
    Triple("cctv", 25, 4), Triple("infrared_sensor", 25, 5), Triple("fire_extinguisher", 0, 8),
    Triple("fire_system", 25, 8), Triple("security_host", 0, 9),
    Triple("table_6b", 1, 6), Triple("table_4b", 5, 6), Triple("table_4b", 9, 6),
    Triple("table_4b", 13, 6), Triple("table_4b", 17, 6), Triple("table_6b", 21, 6),
    Triple("table_4b", 5, 9), Triple("table_4b", 9, 9), Triple("table_4b", 13, 9),
    Triple("table_4b", 17, 9), Triple("table_4b", 21, 9), Triple("table_2b", 23, 9),
    Triple("table_4b", 5, 13), Triple("table_4b", 9, 13), Triple("table_4b", 13, 13),
    Triple("table_8b", 17, 13), Triple("table_2b", 23, 13),
    Triple("counter_bar", 21, 15), Triple("restroom_toilet", 23, 1),
    Triple("restroom_sink", 24, 1), Triple("fountain_small", 23, 6),
    Triple("jukebox", 3, 15), Triple("neon_sign", 0, 12), Triple("painting_landscape", 0, 2),
    Triple("photo_wall", 25, 2), Triple("lantern_row", 14, 15), Triple("carpet_red", 18, 11)
)

private val DECOR_PLAN = listOf(
    "ceiling_lamp", "ceiling_lamp", "pot_plant", "flower_stand", "jukebox", "aquarium", "carpet_red"
)

fun createNewGame(seed: Long = Rng.newSeed()): GameState {
    val rng = Rng(seed)
    val location = getLocation("zhongli_xinming") ?: com.dreamrestaurant.data.LOCATIONS[0]
    val layout = defaultLayout(location.id)
    layout.rev = 1
    layout.items = mutableListOf()

    val state = GameState()
    state.version = SAVE_VERSION
    state.seed = seed
    state.rng = rng.getState()
    state.day = 1
    state.minute = 9 * 60
    state.minuteFloat = 9 * 60.0
    state.absMinute = 9 * 60.0
    state.speed = 1
    state.phase = "build"
    state.locationId = location.id
    state.stars = 1
    state.fame = 6.0
    state.cash = B.START_CASH.toDouble()
    state.uidSeq = 1
    state.layout = layout

    for ((idx, spot) in PREMIUM_STARTER.withIndex()) {
        val def = furnitureById(spot.first) ?: continue
        layout.items.add(
            com.dreamrestaurant.sim.Item(
                uid = "init_$idx", typeId = spot.first, x = spot.second, y = spot.third,
                w = def.w, h = def.h, rot = 0, durability = 100, broken = false
            )
        )
    }

    syncFootprints(layout)
    for (it in layout.items.filter { furnitureById(it.typeId)?.category == "table" }) {
        it.chairUids = autoPlaceChairs(state, it) { s -> nextUid(s as GameState) }.toMutableList()
    }

    for (id in DECOR_PLAN) {
        val def = furnitureById(id)
            ?: com.dreamrestaurant.data.FURNITURE.firstOrNull { it.category == "decor" && !it.blocks }
            ?: continue
        val spot = findAutoPlace(layout, def.id) ?: continue
        layout.items.add(
            com.dreamrestaurant.sim.Item(
                uid = nextUid(state), typeId = def.id, x = spot.x.toInt(), y = spot.y.toInt(),
                w = def.w, h = def.h, rot = 0, durability = 100, broken = false
            )
        )
    }

    val starterDishes = mutableListOf<Dish>()
    com.dreamrestaurant.data.getDish("hamburg_steak")?.let { starterDishes.add(it) }
    if (starterDishes.none { it.name.contains("蛋包飯") }) {
        com.dreamrestaurant.data.DISHES.firstOrNull { it.name.contains("蛋包飯") }
            ?.let { starterDishes.add(it) }
    }
    com.dreamrestaurant.data.DISHES.firstOrNull { it.name.contains("紅茶") }
        ?.let { starterDishes.add(it) }

    val seen = mutableSetOf<String>()
    for (dish in starterDishes) {
        if (!seen.add(dish.id)) continue
        state.menu.add(
            MenuEntry(
                dishId = dish.id,
                price = round((dish.expectedPrice).toDouble()).toInt(),
                grade = dish.gradeDefault, taste = dish.tasteDefault,
                portion = dish.portionDefault, cookTime = dish.cookTimeDefault,
                active = true, sold = 0
            )
        )
        state.stock[dish.id] = 60
        state.store[dish.id] = 0
    }

    val startWaiters = com.dreamrestaurant.data.STAFF_POOL.filter { it.role == "waiter" }
        .sortedBy { it.wage }.take(2)
    val startChef = cheapestStaff("chef")
    for (person in startWaiters + listOfNotNull(startChef)) {
        state.staff.add(makeStaffEntry(state, person, person.initWage))
    }
    for (st in state.staff.filter { it.role == "waiter" }) {
        st.duties = Duties(true, true, true, true, true, false, false)
        st.shift = Shift(10 * 60, 23 * 60)
    }

    state.candidates = safeCandidates(1, 5, rng).toMutableList()

    val weatherRoll = Rng(seed xor 0x5f3a)
    state.sim.weather = rollWeather(location, weatherRoll)
    state.sim.trafficMul = 1.0

    rebuildTables(state)
    layout.rev = layout.rev + 1
    state.layout.rev = layout.rev
    syncMenuLimitNote(state)
    return state
}

fun safeCandidates(day: Int, count: Int, rng: Rng): List<Candidate> {
    val list = makeCandidateList(day, count, rng)
    if (list.isNotEmpty()) return list
    return com.dreamrestaurant.data.STAFF_POOL.take(count).mapIndexed { i, s ->
        Candidate("c_fallback_${i}_${s.id}", s.id, s.initWage.toDouble())
    }
}

private val WEATHER_KEYS = setOf("sunny", "cloudy", "rain", "storm", "cold", "heat")

fun rollWeather(location: LocationDef?, rng: Rng): String {
    val weights = location?.weatherWeights
        ?: mapOf("sunny" to 0.4, "cloudy" to 0.25, "rain" to 0.2, "storm" to 0.05, "cold" to 0.05, "heat" to 0.05)
    val picked = rng.weightedPairs(weights.entries.map { it.key to it.value }) ?: "sunny"
    return if (picked in WEATHER_KEYS) picked else "sunny"
}

fun makeStaffEntry(state: GameState, person: StaffDef, wage: Int): HiredStaff {
    val st = HiredStaff(
        uid = nextUid(state),
        staffId = person.id,
        name = person.name,
        role = person.role,
        wage = max(1, round(wage.toDouble()).toInt()),
        hireDay = state.day,
        specialty = person.specialty,
        appearance = Appearance(
            hair = person.portrait.hair, skin = person.portrait.skin,
            shirt = person.portrait.shirt, hat = person.portrait.hat
        )
    )
    return st
}

fun emptyToday(): TodayStat = TodayStat()

fun syncMenuLimitNote(state: GameState) {
    state.menuLimit = B.MENU_LIMIT[state.stars] ?: 99
}

fun menuLimitFor(stars: Int): Int {
    val s = max(1, min(B.MAX_STARS, round(stars.toDouble()).toInt()))
    return B.MENU_LIMIT[s] ?: 99
}

fun starsRequirement(star: Int): com.dreamrestaurant.core.StarReq {
    val s = max(1, min(B.MAX_STARS, round(star.toDouble()).toInt()))
    return B.STAR_REQS.getOrElse(s) { B.STAR_REQS[B.MAX_STARS] }
}

fun pushLog(state: GameState, text: String, kind: String = "info") {
    state.log.add(LogEntry(state.day, state.minute, text, kind))
    if (state.log.size > 200) state.log.subList(0, state.log.size - 200).clear()
}

/** 開局傢俱（自動重建範本） */
val REBUILD_ITEMS = listOf(
    Triple("kitchen_stove", 1, 1), Triple("kitchen_worktable", 3, 1),
    Triple("kitchen_dishwasher", 5, 1), Triple("fridge", 6, 1),
    Triple("ac_unit", 0, 4), Triple("ceiling_lamp", 10, 0), Triple("stereo", 15, 0),
    Triple("cctv", 19, 4), Triple("infrared_sensor", 19, 5), Triple("fire_extinguisher", 0, 8),
    Triple("fire_system", 19, 8), Triple("security_host", 0, 9),
    Triple("table_6b", 1, 5), Triple("table_6b", 4, 5), Triple("table_6b", 7, 5), Triple("table_6b", 10, 5),
    Triple("table_6b", 1, 9), Triple("table_6b", 4, 9), Triple("table_6b", 7, 9), Triple("table_6b", 10, 9),
    Triple("counter_bar", 14, 10), Triple("restroom_toilet", 16, 1), Triple("restroom_sink", 17, 1),
    Triple("fountain_small", 13, 5), Triple("jukebox", 14, 7), Triple("neon_sign", 0, 6),
    Triple("painting_landscape", 0, 2), Triple("photo_wall", 19, 2), Triple("lantern_row", 13, 10)
)
