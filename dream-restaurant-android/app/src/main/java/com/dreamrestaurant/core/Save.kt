package com.dreamrestaurant.core

import com.dreamrestaurant.data.staffById
import com.dreamrestaurant.sim.Item
import com.dreamrestaurant.sim.Layout
import com.dreamrestaurant.sim.P
import com.dreamrestaurant.sim.Seat
import com.dreamrestaurant.sim.Sidewalk
import com.dreamrestaurant.sim.TableState
import com.dreamrestaurant.sim.recomputeReachability
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

const val SAVE_PREFIX = "dreamrestaurant.save."
val MANUAL_SLOTS = listOf("1", "2", "3", "4", "5")
const val AUTO_SLOT = "auto"

fun saveKey(slot: String): String = SAVE_PREFIX + slot

/** 存檔後端介面（Android 用 SharedPreferences，JVM 測試用記憶體實作） */
interface SaveStorage {
    fun read(key: String): String?
    fun write(key: String, value: String)
    fun remove(key: String)
    fun allKeys(): List<String>
}

data class SaveMeta(val savedAt: String, val label: String)

data class SlotInfo(
    val slot: String,
    val savedAt: String? = null,
    val day: Int? = null,
    val locationId: String? = null,
    val cash: Double? = null,
    val stars: Int? = null,
    val version: Int? = null,
    val broken: Boolean = false
)

data class LoadResult(
    val ok: Boolean,
    val state: GameState? = null,
    val meta: SaveMeta? = null,
    val error: String? = null
)

/* ------------------------------------------------------------ JSON 小工具 */

private fun putD(o: JSONObject, key: String, v: Double) {
    if (v.isNaN() || v.isInfinite()) o.put(key, JSONObject.NULL) else o.put(key, v)
}

private fun putDO(o: JSONObject, key: String, v: Double?) {
    if (v == null) o.put(key, JSONObject.NULL) else putD(o, key, v)
}

private fun optD(o: JSONObject, key: String, def: Double = 0.0): Double =
    if (o.has(key) && !o.isNull(key)) o.optDouble(key, def) else def

private fun optDO(o: JSONObject, key: String): Double? {
    if (!o.has(key) || o.isNull(key)) return null
    val v = o.optDouble(key, Double.NaN)
    return if (v.isNaN()) null else v
}

private fun optI(o: JSONObject, key: String, def: Int = 0): Int =
    if (o.has(key) && !o.isNull(key)) o.optInt(key, def) else def

private fun optIO(o: JSONObject, key: String): Int? {
    if (!o.has(key) || o.isNull(key)) return null
    return o.optInt(key, Int.MIN_VALUE).takeIf { it != Int.MIN_VALUE }
}

private fun optB(o: JSONObject, key: String, def: Boolean = false): Boolean =
    if (o.has(key) && !o.isNull(key)) o.optBoolean(key, def) else def

private fun optS(o: JSONObject, key: String, def: String? = null): String? =
    if (o.has(key) && !o.isNull(key)) o.optString(key, def ?: "") else def

private fun arrOf(items: List<String>): JSONArray {
    val a = JSONArray()
    for (i in items) a.put(i)
    return a
}

private fun listOfStr(a: JSONArray?): MutableList<String> {
    val out = mutableListOf<String>()
    if (a == null) return out
    for (i in 0 until a.length()) out.add(a.optString(i))
    return out
}

private fun arrOfDouble(items: List<Double>): JSONArray {
    val a = JSONArray()
    for (i in items) a.put(if (i.isNaN() || i.isInfinite()) JSONObject.NULL else i)
    return a
}

private fun listOfDouble(a: JSONArray?): MutableList<Double> {
    val out = mutableListOf<Double>()
    if (a == null) return out
    for (i in 0 until a.length()) out.add(if (a.isNull(i)) 0.0 else a.optDouble(i, 0.0))
    return out
}

private fun pJson(p: P?): JSONObject? {
    if (p == null) return null
    val o = JSONObject()
    putD(o, "x", p.x); putD(o, "y", p.y)
    return o
}

private fun pOf(o: JSONObject?): P? {
    if (o == null) return null
    return P(optD(o, "x"), optD(o, "y"))
}

private fun pList(items: List<P>): JSONArray {
    val a = JSONArray()
    for (p in items) a.put(pJson(p))
    return a
}

private fun pListIn(a: JSONArray?): MutableList<P> {
    val out = mutableListOf<P>()
    if (a == null) return out
    for (i in 0 until a.length()) {
        val o = a.optJSONObject(i) ?: continue
        out.add(P(optD(o, "x"), optD(o, "y")))
    }
    return out
}

/* -------------------------------------------------------------- 序列化 */

fun appearanceJson(a: Appearance): JSONObject {
    val o = JSONObject()
    o.put("hair", a.hair); o.put("skin", a.skin); o.put("shirt", a.shirt); o.put("hat", a.hat)
    if (a.sheet != null) o.put("sheet", a.sheet) else o.put("sheet", JSONObject.NULL)
    if (a.name != null) o.put("name", a.name) else o.put("name", JSONObject.NULL)
    return o
}

fun appearanceOf(o: JSONObject): Appearance =
    Appearance(
        hair = optS(o, "hair", "#2b1b12") ?: "#2b1b12",
        skin = optS(o, "skin", "#f0c9a0") ?: "#f0c9a0",
        shirt = optS(o, "shirt", "#3a6ea5") ?: "#3a6ea5",
        hat = optI(o, "hat", 0),
        sheet = optS(o, "sheet"),
        name = optS(o, "name")
    )

private fun itemJson(it: Item): JSONObject {
    val o = JSONObject()
    o.put("uid", it.uid); o.put("typeId", it.typeId)
    o.put("x", it.x); o.put("y", it.y); o.put("w", it.w); o.put("h", it.h)
    o.put("rot", it.rot); o.put("durability", it.durability); o.put("broken", it.broken)
    if (it.chairUids != null) o.put("chairUids", arrOf(it.chairUids!!)) else o.put("chairUids", JSONObject.NULL)
    if (it.chairFor != null) o.put("chairFor", it.chairFor) else o.put("chairFor", JSONObject.NULL)
    if (it.tableUid != null) o.put("tableUid", it.tableUid) else o.put("tableUid", JSONObject.NULL)
    o.put("autoChair", it.autoChair)
    o.put("rotManual", it.rotManual)
    if (it.rotAuto != null) o.put("rotAuto", it.rotAuto) else o.put("rotAuto", JSONObject.NULL)
    if (it.chairTypeId != null) o.put("chairTypeId", it.chairTypeId) else o.put("chairTypeId", JSONObject.NULL)
    return o
}

private fun itemOf(o: JSONObject): Item =
    Item(
        uid = optS(o, "uid", "") ?: "",
        typeId = optS(o, "typeId", "") ?: "",
        x = optI(o, "x"), y = optI(o, "y"),
        w = optI(o, "w", 1), h = optI(o, "h", 1),
        rot = optI(o, "rot"),
        durability = optI(o, "durability", 100),
        broken = optB(o, "broken"),
        chairUids = if (o.has("chairUids") && !o.isNull("chairUids")) listOfStr(o.optJSONArray("chairUids")) else null,
        chairFor = optS(o, "chairFor"),
        tableUid = optS(o, "tableUid"),
        autoChair = optB(o, "autoChair"),
        rotManual = optB(o, "rotManual"),
        rotAuto = optIO(o, "rotAuto"),
        chairTypeId = optS(o, "chairTypeId")
    )

private fun layoutJson(l: Layout): JSONObject {
    val o = JSONObject()
    o.put("gridW", l.gridW); o.put("gridH", l.gridH)
    o.put("tiles", arrOf(l.tiles))
    val items = JSONArray()
    for (i in l.items) items.put(itemJson(i))
    o.put("items", items)
    o.put("door", pJson(l.door))
    o.put("outside", pJson(l.outside))
    o.put("kitchenTiles", pList(l.kitchenTiles))
    o.put("passTiles", pList(l.passTiles))
    o.put("restroomTiles", pList(l.restroomTiles))
    o.put("restroom", pJson(l.restroom))
    val sw = JSONObject()
    putD(sw, "y", l.sidewalk.y); sw.put("x0", l.sidewalk.x0); sw.put("x1", l.sidewalk.x1)
    o.put("sidewalk", sw)
    o.put("rev", l.rev)
    return o
}

private fun layoutOf(o: JSONObject): Layout {
    val l = Layout()
    l.gridW = optI(o, "gridW", l.gridW)
    l.gridH = optI(o, "gridH", l.gridH)
    l.tiles = listOfStr(o.optJSONArray("tiles"))
    if (l.tiles.isEmpty()) l.tiles = MutableList(l.gridW * l.gridH) { "floor" }
    l.items = mutableListOf()
    val items = o.optJSONArray("items")
    if (items != null) for (i in 0 until items.length()) items.optJSONObject(i)?.let { l.items.add(itemOf(it)) }
    l.door = pOf(o.optJSONObject("door")) ?: P(0, 0)
    l.outside = pOf(o.optJSONObject("outside")) ?: P(0.0, 0.0)
    l.kitchenTiles = pListIn(o.optJSONArray("kitchenTiles"))
    l.passTiles = pListIn(o.optJSONArray("passTiles"))
    l.restroomTiles = pListIn(o.optJSONArray("restroomTiles"))
    l.restroom = pOf(o.optJSONObject("restroom"))
    val sw = o.optJSONObject("sidewalk")
    if (sw != null) {
        l.sidewalk = Sidewalk(optD(sw, "y"), optI(sw, "x0", 1), optI(sw, "x1", 1))
    }
    l.rev = optI(o, "rev", 1)
    return l
}

private fun seatJson(s: Seat): JSONObject {
    val o = JSONObject()
    o.put("x", s.x); o.put("y", s.y); o.put("facing", s.facing)
    o.put("chair", s.chair); o.put("reachDoor", s.reachDoor); o.put("reachPass", s.reachPass)
    return o
}

private fun seatOf(o: JSONObject): Seat =
    Seat(
        x = optI(o, "x"), y = optI(o, "y"),
        facing = optS(o, "facing", "S") ?: "S",
        chair = optB(o, "chair"),
        reachDoor = optB(o, "reachDoor", true),
        reachPass = optB(o, "reachPass", true)
    )

private fun staffJson(s: HiredStaff): JSONObject {
    val o = JSONObject()
    o.put("uid", s.uid); o.put("staffId", s.staffId); o.put("name", s.name); o.put("role", s.role)
    o.put("wage", s.wage); o.put("hireDay", s.hireDay)
    val sh = JSONObject(); sh.put("start", s.shift.start); sh.put("end", s.shift.end)
    o.put("shift", sh)
    val d = JSONObject()
    d.put("escort", s.duties.escort); d.put("serve", s.duties.serve); d.put("order", s.duties.order)
    d.put("bus", s.duties.bus); d.put("cleanRestroom", s.duties.cleanRestroom)
    d.put("cleanFloor", s.duties.cleanFloor); d.put("cashier", s.duties.cashier)
    o.put("duties", d)
    putD(o, "fatigue", s.fatigue); putD(o, "mood", s.mood)
    o.put("specialty", s.specialty); putD(o, "speedMod", s.speedMod)
    o.put("working", s.working); putD(o, "hoursToday", s.hoursToday)
    putD(o, "x", s.x); putD(o, "y", s.y)
    o.put("dir", s.dir); putD(o, "frame", s.frame)
    o.put("path", JSONArray()); o.put("pathIndex", 0)
    if (s.task != null) o.put("task", s.task) else o.put("task", JSONObject.NULL)
    o.put("state", s.state); putD(o, "restTimer", s.restTimer)
    o.put("appearance", appearanceJson(s.appearance))
    return o
}

private fun staffOf(o: JSONObject): HiredStaff {
    val st = HiredStaff(
        uid = optS(o, "uid", "") ?: "",
        staffId = optS(o, "staffId", "") ?: "",
        name = optS(o, "name", "") ?: "",
        role = optS(o, "role", "waiter") ?: "waiter",
        wage = optI(o, "wage", 2),
        hireDay = optI(o, "hireDay", 1)
    )
    val sh = o.optJSONObject("shift")
    if (sh != null) st.shift = Shift(optI(sh, "start", 600), optI(sh, "end", 1380))
    val d = o.optJSONObject("duties")
    if (d != null) {
        st.duties = Duties(
            escort = optB(d, "escort", true), serve = optB(d, "serve", true),
            order = optB(d, "order", true), bus = optB(d, "bus", true),
            cleanRestroom = optB(d, "cleanRestroom"), cleanFloor = optB(d, "cleanFloor"),
            cashier = optB(d, "cashier")
        )
    }
    st.fatigue = optD(o, "fatigue"); st.mood = optD(o, "mood", 70.0)
    st.specialty = optS(o, "specialty", "all") ?: "all"
    st.speedMod = optD(o, "speedMod", 1.0)
    st.working = optB(o, "working"); st.hoursToday = optD(o, "hoursToday")
    st.x = optD(o, "x"); st.y = optD(o, "y")
    st.dir = optS(o, "dir", "S") ?: "S"; st.frame = optD(o, "frame")
    st.task = optS(o, "task")
    st.state = optS(o, "state", "idle") ?: "idle"
    st.restTimer = optD(o, "restTimer")
    o.optJSONObject("appearance")?.let { st.appearance = appearanceOf(it) }
    return st
}

private fun customerJson(c: Customer): JSONObject {
    val o = JSONObject()
    o.put("uid", c.uid); o.put("type", c.type)
    o.put("appearance", appearanceJson(c.appearance))
    putD(o, "mood", c.mood); putD(o, "patience", c.patience); putD(o, "budget", c.budget)
    o.put("partySize", c.partySize)
    putD(o, "x", c.x); putD(o, "y", c.y); o.put("dir", c.dir); putD(o, "frame", c.frame)
    o.put("path", JSONArray()); o.put("pathIndex", 0)
    o.put("state", c.state)
    if (c.tableUid != null) o.put("tableUid", c.tableUid) else o.put("tableUid", JSONObject.NULL)
    o.put("seat", pJson(c.seat) ?: JSONObject.NULL)
    o.put("seatedDir", c.seatedDir)
    putD(o, "enterMinute", c.enterMinute)
    putDO(o, "seatMinute", c.seatMinute); putDO(o, "orderMinute", c.orderMinute)
    putDO(o, "firstFoodMinute", c.firstFoodMinute); putDO(o, "eatDoneMinute", c.eatDoneMinute)
    putD(o, "waitMin", c.waitMin)
    val order = JSONArray()
    for (l in c.order) {
        val lo = JSONObject()
        lo.put("dishId", l.dishId); lo.put("price", l.price); lo.put("cookTime", l.cookTime)
        lo.put("grade", l.grade); lo.put("taste", l.taste); lo.put("portion", l.portion)
        putD(lo, "score", l.score); putD(lo, "value", l.value)
        lo.put("ready", l.ready); lo.put("delivered", l.delivered)
        order.put(lo)
    }
    o.put("order", order)
    putD(o, "dishScoreAvg", c.dishScoreAvg); putD(o, "valueScore", c.valueScore)
    putD(o, "spent", c.spent); putD(o, "tip", c.tip)
    o.put("leftAngry", c.leftAngry); o.put("wasCritic", c.wasCritic)
    o.put("outsideRoll", c.outsideRoll)
    if (c.bubble != null) o.put("bubble", c.bubble) else o.put("bubble", JSONObject.NULL)
    if (c.bubbleKind != null) o.put("bubbleKind", c.bubbleKind) else o.put("bubbleKind", JSONObject.NULL)
    putD(o, "bubbleUntil", c.bubbleUntil)
    putD(o, "prefTaste", c.prefTaste); o.put("prefTags", arrOf(c.prefTags))
    o.put("queueSpot", pJson(c.queueSpot) ?: JSONObject.NULL)
    o.put("queueIndex", c.queueIndex)
    val ml = JSONArray()
    for (a in c.memberLooks) ml.put(appearanceJson(a))
    o.put("memberLooks", ml)
    val si = JSONArray(); for (i in c.seatIndices) si.put(i)
    o.put("seatIndices", si)
    val mem = JSONArray()
    for (m in c.members) {
        val mo = JSONObject()
        mo.put("seat", pJson(m.seat)); mo.put("dir", m.dir)
        mo.put("appearance", appearanceJson(m.appearance)); mo.put("eating", m.eating); mo.put("frame", m.frame)
        mem.put(mo)
    }
    o.put("members", mem)
    o.put("complained", c.complained)
    o.put("departing", c.departing); o.put("done", c.done)
    if (c.leaveReason != null) o.put("leaveReason", c.leaveReason) else o.put("leaveReason", JSONObject.NULL)
    putD(o, "leaveMinute", c.leaveMinute)
    o.put("queueTarget", pJson(c.queueTarget) ?: JSONObject.NULL)
    if (c.tableUidOrig != null) o.put("tableUidOrig", c.tableUidOrig) else o.put("tableUidOrig", JSONObject.NULL)
    if (c.seatIndicesOrig != null) {
        val sio = JSONArray(); for (i in c.seatIndicesOrig!!) sio.put(i); o.put("seatIndicesOrig", sio)
    } else o.put("seatIndicesOrig", JSONObject.NULL)
    o.put("selfSeated", c.selfSeated)
    putDO(o, "selfPayAt", c.selfPayAt)
    o.put("paid", c.paid)
    putDO(o, "partyVoice", c.partyVoice)
    if (c.ratingBucket != null) o.put("ratingBucket", c.ratingBucket) else o.put("ratingBucket", JSONObject.NULL)
    putD(o, "ratingDelta", c.ratingDelta)
    return o
}

private fun customerOf(o: JSONObject): Customer {
    val c = Customer(
        uid = optS(o, "uid", "") ?: "",
        type = optS(o, "type", "family") ?: "family"
    )
    o.optJSONObject("appearance")?.let { c.appearance = appearanceOf(it) }
    c.mood = optD(o, "mood"); c.patience = optD(o, "patience", 60.0); c.budget = optD(o, "budget")
    c.partySize = optI(o, "partySize", 1)
    c.x = optD(o, "x"); c.y = optD(o, "y")
    c.dir = optS(o, "dir", "N") ?: "N"; c.frame = optD(o, "frame")
    c.state = optS(o, "state", "arriving") ?: "arriving"
    c.tableUid = optS(o, "tableUid")
    c.seat = pOf(o.optJSONObject("seat"))
    c.seatedDir = optS(o, "seatedDir", "S") ?: "S"
    c.enterMinute = optD(o, "enterMinute")
    c.seatMinute = optDO(o, "seatMinute"); c.orderMinute = optDO(o, "orderMinute")
    c.firstFoodMinute = optDO(o, "firstFoodMinute"); c.eatDoneMinute = optDO(o, "eatDoneMinute")
    c.waitMin = optD(o, "waitMin")
    val order = o.optJSONArray("order")
    if (order != null) for (i in 0 until order.length()) {
        val lo = order.optJSONObject(i) ?: continue
        c.order.add(
            OrderLine(
                dishId = optS(lo, "dishId", "") ?: "",
                price = optI(lo, "price"), cookTime = optI(lo, "cookTime", 25),
                grade = optI(lo, "grade", 50), taste = optI(lo, "taste", 50),
                portion = optI(lo, "portion", 50),
                score = optD(lo, "score"), value = optD(lo, "value", 1.0),
                ready = optB(lo, "ready"), delivered = optB(lo, "delivered")
            )
        )
    }
    c.dishScoreAvg = optD(o, "dishScoreAvg"); c.valueScore = optD(o, "valueScore", 1.0)
    c.spent = optD(o, "spent"); c.tip = optD(o, "tip")
    c.leftAngry = optB(o, "leftAngry"); c.wasCritic = optB(o, "wasCritic")
    c.outsideRoll = optB(o, "outsideRoll")
    c.bubble = optS(o, "bubble"); c.bubbleKind = optS(o, "bubbleKind")
    c.bubbleUntil = optD(o, "bubbleUntil")
    c.prefTaste = optD(o, "prefTaste", 55.0); c.prefTags = listOfStr(o.optJSONArray("prefTags"))
    c.queueSpot = pOf(o.optJSONObject("queueSpot")); c.queueIndex = optI(o, "queueIndex")
    c.memberLooks = mutableListOf()
    val ml = o.optJSONArray("memberLooks")
    if (ml != null) for (i in 0 until ml.length()) ml.optJSONObject(i)?.let { c.memberLooks.add(appearanceOf(it)) }
    c.seatIndices = mutableListOf()
    val si = o.optJSONArray("seatIndices")
    if (si != null) for (i in 0 until si.length()) c.seatIndices.add(si.optInt(i))
    c.members = mutableListOf()
    val mem = o.optJSONArray("members")
    if (mem != null) for (i in 0 until mem.length()) {
        val mo = mem.optJSONObject(i) ?: continue
        c.members.add(
            Member(
                seat = pOf(mo.optJSONObject("seat")) ?: P(0, 0),
                dir = optS(mo, "dir", "S") ?: "S",
                appearance = mo.optJSONObject("appearance")?.let { appearanceOf(it) } ?: Appearance(),
                eating = optB(mo, "eating"),
                frame = optI(mo, "frame")
            )
        )
    }
    c.complained = optB(o, "complained")
    c.departing = optB(o, "departing"); c.done = optB(o, "done")
    c.leaveReason = optS(o, "leaveReason"); c.leaveMinute = optD(o, "leaveMinute")
    c.queueTarget = pOf(o.optJSONObject("queueTarget"))
    c.tableUidOrig = optS(o, "tableUidOrig")
    c.seatIndicesOrig = if (o.has("seatIndicesOrig") && !o.isNull("seatIndicesOrig")) {
        val a = o.optJSONArray("seatIndicesOrig")
        val out = mutableListOf<Int>()
        if (a != null) for (i in 0 until a.length()) out.add(a.optInt(i))
        out
    } else null
    c.selfSeated = optB(o, "selfSeated")
    c.selfPayAt = optDO(o, "selfPayAt")
    c.paid = optB(o, "paid")
    c.partyVoice = optDO(o, "partyVoice")
    c.ratingBucket = optS(o, "ratingBucket")
    c.ratingDelta = optD(o, "ratingDelta")
    return c
}

private fun todayJson(t: TodayStat): JSONObject {
    val o = JSONObject()
    putD(o, "revenue", t.revenue); putD(o, "spend", t.spend); putD(o, "tips", t.tips)
    putD(o, "wages", t.wages); putD(o, "rent", t.rent); o.put("utilities", t.utilities)
    putD(o, "inventory", t.inventory); putD(o, "repairs", t.repairs)
    o.put("guests", t.guests); o.put("parties", t.parties); o.put("served", t.served)
    o.put("angry", t.angry); o.put("noBigTable", t.noBigTable)
    putD(o, "waitSum", t.waitSum); o.put("waitCount", t.waitCount)
    putD(o, "moodSum", t.moodSum); o.put("moodCount", t.moodCount)
    val cm = JSONObject()
    for ((k, v) in t.complaints) cm.put(k, v)
    o.put("complaints", cm)
    o.put("weather", t.weather); o.put("decorations", t.decorations)
    return o
}

private fun todayOf(o: JSONObject?): TodayStat {
    val t = TodayStat()
    if (o == null) return t
    t.revenue = optD(o, "revenue"); t.spend = optD(o, "spend"); t.tips = optD(o, "tips")
    t.wages = optD(o, "wages"); t.rent = optD(o, "rent"); t.utilities = optI(o, "utilities")
    t.inventory = optD(o, "inventory"); t.repairs = optD(o, "repairs")
    t.guests = optI(o, "guests"); t.parties = optI(o, "parties"); t.served = optI(o, "served")
    t.angry = optI(o, "angry"); t.noBigTable = optI(o, "noBigTable")
    t.waitSum = optD(o, "waitSum"); t.waitCount = optI(o, "waitCount")
    t.moodSum = optD(o, "moodSum"); t.moodCount = optI(o, "moodCount")
    val cm = o.optJSONObject("complaints")
    if (cm != null) for (k in cm.keys()) t.complaints[k] = cm.optInt(k)
    t.weather = optS(o, "weather", "sunny") ?: "sunny"
    t.decorations = optI(o, "decorations")
    return t
}

private fun dailyJson(d: DailyRecord): JSONObject {
    val o = JSONObject()
    o.put("day", d.day); o.put("locationId", d.locationId); o.put("weather", d.weather)
    o.put("revenue", d.revenue); o.put("tips", d.tips); o.put("spend", d.spend)
    o.put("profit", d.profit); o.put("inventory", d.inventory)
    o.put("wages", d.wages); o.put("rent", d.rent); o.put("utilities", d.utilities)
    o.put("repairs", d.repairs); o.put("guests", d.guests); o.put("parties", d.parties)
    o.put("served", d.served); o.put("angry", d.angry)
    o.put("avgWaitSec", d.avgWaitSec); putD(o, "avgMood", d.avgMood)
    val cm = JSONObject(); for ((k, v) in d.complaints) cm.put(k, v)
    o.put("complaints", cm)
    o.put("decor", d.decor)
    putD(o, "repCommunity", d.repCommunity); putD(o, "repOutside", d.repOutside)
    putD(o, "fame", d.fame); o.put("stars", d.stars)
    if (d.magazineRank != null) o.put("magazineRank", d.magazineRank) else o.put("magazineRank", JSONObject.NULL)
    putD(o, "dishScoreAvg", d.dishScoreAvg); putD(o, "valueScoreAvg", d.valueScoreAvg)
    return o
}

private fun dailyOf(o: JSONObject): DailyRecord {
    val cm = o.optJSONObject("complaints")
    val complaints = mutableMapOf<String, Int>()
    if (cm != null) for (k in cm.keys()) complaints[k] = cm.optInt(k)
    return DailyRecord(
        day = optI(o, "day"), locationId = optS(o, "locationId", "") ?: "",
        weather = optS(o, "weather", "sunny") ?: "sunny",
        revenue = optI(o, "revenue"), tips = optI(o, "tips"), spend = optI(o, "spend"),
        profit = optI(o, "profit"), inventory = optI(o, "inventory"),
        wages = optI(o, "wages"), rent = optI(o, "rent"), utilities = optI(o, "utilities"),
        repairs = optI(o, "repairs"), guests = optI(o, "guests"), parties = optI(o, "parties"),
        served = optI(o, "served"), angry = optI(o, "angry"),
        avgWaitSec = optI(o, "avgWaitSec"), avgMood = optD(o, "avgMood"),
        complaints = complaints, decor = optI(o, "decor"),
        repCommunity = optD(o, "repCommunity"), repOutside = optD(o, "repOutside"),
        fame = optD(o, "fame"), stars = optI(o, "stars", 1),
        magazineRank = optIO(o, "magazineRank"),
        dishScoreAvg = optD(o, "dishScoreAvg"), valueScoreAvg = optD(o, "valueScoreAvg")
    )
}

private fun magEntryJson(e: MagEntry): JSONObject {
    val o = JSONObject(); o.put("name", e.name); putD(o, "score", e.score)
    o.put("me", e.me); o.put("rank", e.rank); return o
}

private fun magEntryOf(o: JSONObject): MagEntry =
    MagEntry(optS(o, "name", "") ?: "", optD(o, "score"), optB(o, "me"), optI(o, "rank"))

private fun magBoardJson(b: MagBoard): JSONObject {
    val o = JSONObject()
    o.put("rank", b.rank); putD(o, "score", b.score)
    val tl = JSONArray(); for (e in b.topList) tl.put(magEntryJson(e))
    o.put("topList", tl); o.put("category", b.category); return o
}

private fun magBoardOf(o: JSONObject): MagBoard {
    val b = MagBoard(optI(o, "rank"), optD(o, "score"), category = optS(o, "category", "") ?: "")
    val tl = o.optJSONArray("topList")
    if (tl != null) for (i in 0 until tl.length()) tl.optJSONObject(i)?.let { b.topList.add(magEntryOf(it)) }
    return b
}

private fun weeklyJson(w: WeeklyRecord): JSONObject {
    val o = JSONObject()
    o.put("week", w.week); o.put("startDay", w.startDay); o.put("endDay", w.endDay)
    o.put("revenue", w.revenue); o.put("profit", w.profit); o.put("guests", w.guests)
    o.put("served", w.served); o.put("angry", w.angry)
    val sc = JSONObject(); for ((k, v) in w.scores) putD(sc, k, v)
    o.put("scores", sc)
    val rk = JSONObject(); for ((k, v) in w.ranks) rk.put(k, v)
    o.put("ranks", rk)
    o.put("totalRank", w.totalRank); o.put("prize", w.prize)
    putD(o, "repCommunity", w.repCommunity); putD(o, "repOutside", w.repOutside)
    o.put("stars", w.stars)
    val tl = JSONArray(); for (e in w.topList) tl.put(magEntryJson(e))
    o.put("topList", tl)
    return o
}

private fun weeklyOf(o: JSONObject): WeeklyRecord {
    val scores = mutableMapOf<String, Double>()
    o.optJSONObject("scores")?.let { sc -> for (k in sc.keys()) scores[k] = optD(sc, k) }
    val ranks = mutableMapOf<String, Int>()
    o.optJSONObject("ranks")?.let { rk -> for (k in rk.keys()) ranks[k] = rk.optInt(k) }
    val w = WeeklyRecord(
        week = optI(o, "week"), startDay = optI(o, "startDay"), endDay = optI(o, "endDay"),
        revenue = optI(o, "revenue"), profit = optI(o, "profit"), guests = optI(o, "guests"),
        served = optI(o, "served"), angry = optI(o, "angry"),
        scores = scores, ranks = ranks,
        totalRank = optI(o, "totalRank"), prize = optI(o, "prize"),
        repCommunity = optD(o, "repCommunity"), repOutside = optD(o, "repOutside"),
        stars = optI(o, "stars", 1)
    )
    val tl = o.optJSONArray("topList")
    if (tl != null) for (i in 0 until tl.length()) tl.optJSONObject(i)?.let { w.topList.add(magEntryOf(it)) }
    return w
}

private fun simJson(sim: SimState): JSONObject {
    val o = JSONObject()
    val customers = JSONArray(); for (c in sim.customers) customers.put(customerJson(c))
    o.put("customers", customers)
    val walkers = JSONArray()
    for (w in sim.walkers) {
        val wo = JSONObject()
        wo.put("uid", w.uid); putD(wo, "x", w.x); putD(wo, "y", w.y); wo.put("dir", w.dir)
        wo.put("dx", w.dx); putD(wo, "speed", w.speed); putD(wo, "frame", w.frame)
        wo.put("type", w.type); wo.put("appearance", appearanceJson(w.appearance)); putD(wo, "life", w.life)
        walkers.put(wo)
    }
    o.put("walkers", walkers)
    val tables = JSONArray()
    for (t in sim.tables) {
        val to = JSONObject()
        to.put("uid", t.uid); to.put("itemUid", t.itemUid)
        to.put("x", t.x); to.put("y", t.y); to.put("w", t.w); to.put("h", t.h)
        to.put("name", t.name)
        val seats = JSONArray(); for (s in t.seats) seats.put(seatJson(s))
        to.put("seats", seats)
        to.put("usable", t.usable)
        to.put("serviceTile", if (t.serviceTile != null) seatJson(t.serviceTile!!) else JSONObject.NULL)
        val occ = JSONArray(); for (u in t.occupants) occ.put(u)
        to.put("occupants", occ)
        to.put("state", t.state)
        putDO(to, "dirtySince", t.dirtySince)
        if (t.waiterUid != null) to.put("waiterUid", t.waiterUid) else to.put("waiterUid", JSONObject.NULL)
        val po = JSONArray(); for (u in t.pendingOrders) po.put(u)
        to.put("pendingOrders", po)
        putD(to, "cleanProgress", t.cleanProgress)
        tables.put(to)
    }
    o.put("tables", tables)
    val tasks = JSONArray()
    for (t in sim.tasks) {
        val to = JSONObject()
        to.put("id", t.id); to.put("kind", t.kind); putD(to, "createdMinute", t.createdMinute)
        if (t.claimedBy != null) to.put("claimedBy", t.claimedBy) else to.put("claimedBy", JSONObject.NULL)
        if (t.tableUid != null) to.put("tableUid", t.tableUid) else to.put("tableUid", JSONObject.NULL)
        if (t.customerUid != null) to.put("customerUid", t.customerUid) else to.put("customerUid", JSONObject.NULL)
        if (t.cleanTarget != null) to.put("cleanTarget", t.cleanTarget) else to.put("cleanTarget", JSONObject.NULL)
        if (t.seatIndex != null) to.put("seatIndex", t.seatIndex) else to.put("seatIndex", JSONObject.NULL)
        if (t.seatIndices != null) {
            val a = JSONArray(); for (i in t.seatIndices!!) a.put(i); to.put("seatIndices", a)
        } else to.put("seatIndices", JSONObject.NULL)
        if (t.stage != null) to.put("stage", t.stage) else to.put("stage", JSONObject.NULL)
        to.put("waitingForSeat", t.waitingForSeat); to.put("failed", t.failed)
        if (t.delay != null) to.put("delay", t.delay) else to.put("delay", JSONObject.NULL)
        tasks.put(to)
    }
    o.put("tasks", tasks)
    val kj = JSONArray()
    for (j in sim.kitchen) {
        val jo = JSONObject()
        jo.put("id", j.id); jo.put("dishId", j.dishId); jo.put("tableUid", j.tableUid)
        jo.put("customerUid", j.customerUid); putD(jo, "score", j.score)
        putD(jo, "remaining", j.remaining); putD(jo, "total", j.total)
        if (j.chefUid != null) jo.put("chefUid", j.chefUid) else jo.put("chefUid", JSONObject.NULL)
        jo.put("started", j.started)
        kj.put(jo)
    }
    o.put("kitchen", kj)
    val pass = JSONArray()
    for (p in sim.pass) {
        val po = JSONObject()
        po.put("id", p.id); po.put("dishId", p.dishId); po.put("tableUid", p.tableUid)
        po.put("customerUid", p.customerUid); putD(po, "score", p.score)
        putD(po, "remaining", p.remaining); putD(po, "total", p.total)
        if (p.chefUid != null) po.put("chefUid", p.chefUid) else po.put("chefUid", JSONObject.NULL)
        po.put("started", p.started); putD(po, "readyAt", p.readyAt); po.put("pickedUp", p.pickedUp)
        pass.put(po)
    }
    o.put("pass", pass)
    val cl = JSONArray()
    for (c in sim.complaintLog) {
        val co = JSONObject()
        co.put("reason", c.reason); co.put("type", c.type); co.put("day", c.day)
        co.put("minute", c.minute); co.put("mood", c.mood); co.put("wait", c.wait)
        cl.put(co)
    }
    o.put("complaintLog", cl)
    val sl = JSONArray()
    for (s in sim.servedLog) {
        val so = JSONObject()
        so.put("dishIds", arrOf(s.dishIds)); putD(so, "spent", s.spent); putD(so, "mood", s.mood)
        so.put("party", s.party); sl.put(so)
    }
    o.put("servedLog", sl)
    val vl = JSONArray()
    for (v in sim.visitLog) {
        val vo = JSONObject()
        vo.put("type", v.type); putD(vo, "enter", v.enter); putDO(vo, "seat", v.seat)
        putDO(vo, "order", v.order); putDO(vo, "food", v.food); putD(vo, "leave", v.leave)
        vo.put("reason", v.reason); vo.put("mood", v.mood); putD(vo, "spent", v.spent)
        vo.put("dishes", v.dishes); vo.put("partySize", v.partySize)
        vl.put(vo)
    }
    o.put("visitLog", vl)
    putD(o, "lureBoost", sim.lureBoost); putD(o, "lureDecayMinute", sim.lureDecayMinute)
    val ae = JSONArray()
    for (e in sim.activeEvents) {
        val eo = JSONObject()
        eo.put("eventId", e.eventId); eo.put("name", e.name); putD(eo, "until", e.until)
        putD(eo, "trafficMul", e.trafficMul); ae.put(eo)
    }
    o.put("activeEvents", ae)
    putD(o, "trafficMul", sim.trafficMul); putD(o, "supplierPriceMul", sim.supplierPriceMul)
    putD(o, "supplierPriceMulUntil", sim.supplierPriceMulUntil)
    val dirt = JSONObject(); putD(dirt, "floor", sim.dirt.floor); putD(dirt, "restroom", sim.dirt.restroom)
    o.put("dirt", dirt)
    val eb = JSONObject()
    eb.put("ac", sim.equipBroken.ac); eb.put("stove", sim.equipBroken.stove); eb.put("fridge", sim.equipBroken.fridge)
    o.put("equipBroken", eb)
    putD(o, "spawnAccumulator", sim.spawnAccumulator)
    o.put("weather", sim.weather); putD(o, "eventTimer", sim.eventTimer)
    o.put("todayDishScores", arrOfDouble(sim.todayDishScores))
    o.put("todayValueScores", arrOfDouble(sim.todayValueScores))
    o.put("todayMoods", arrOfDouble(sim.todayMoods))
    o.put("customersSpawned", sim.customersSpawned); o.put("customersLost", sim.customersLost)
    o.put("lureClicks", sim.lureClicks)
    o.put("skippedBigParties", sim.skippedBigParties); o.put("skippedBiggest", sim.skippedBiggest)
    o.put("closingSoon", sim.closingSoon); o.put("lastOrderMinute", sim.lastOrderMinute)
    putDO(o, "closingSince", sim.closingSince)
    if (sim.forceType != null) o.put("forceType", sim.forceType) else o.put("forceType", JSONObject.NULL)
    o.put("forceTypeLeft", sim.forceTypeLeft)
    return o
}

private fun simOf(o: JSONObject): SimState {
    val sim = SimState()
    o.optJSONArray("customers")?.let { a ->
        for (i in 0 until a.length()) a.optJSONObject(i)?.let { sim.customers.add(customerOf(it)) }
    }
    o.optJSONArray("walkers")?.let { a ->
        for (i in 0 until a.length()) {
            val wo = a.optJSONObject(i) ?: continue
            sim.walkers.add(
                Walker(
                    uid = optS(wo, "uid", "") ?: "", x = optD(wo, "x"), y = optD(wo, "y"),
                    dir = optS(wo, "dir", "S") ?: "S", dx = optI(wo, "dx", 1),
                    speed = optD(wo, "speed", 1.0), frame = optD(wo, "frame"),
                    type = optS(wo, "type", "ped") ?: "ped",
                    appearance = wo.optJSONObject("appearance")?.let { appearanceOf(it) } ?: Appearance(),
                    life = optD(wo, "life")
                )
            )
        }
    }
    o.optJSONArray("tables")?.let { a ->
        for (i in 0 until a.length()) {
            val to = a.optJSONObject(i) ?: continue
            val t = TableState(
                uid = optS(to, "uid", "") ?: "", itemUid = optS(to, "itemUid", "") ?: "",
                x = optI(to, "x"), y = optI(to, "y"), w = optI(to, "w", 1), h = optI(to, "h", 1),
                name = optS(to, "name", "") ?: "", seats = mutableListOf(),
                usable = optB(to, "usable"), serviceTile = null
            )
            val seats = to.optJSONArray("seats")
            if (seats != null) for (j in 0 until seats.length()) seats.optJSONObject(j)?.let { t.seats.add(seatOf(it)) }
            to.optJSONObject("serviceTile")?.let { t.serviceTile = seatOf(it) }
            val occ = to.optJSONArray("occupants")
            if (occ != null) for (j in 0 until occ.length()) t.occupants.add(occ.optString(j))
            t.state = optS(to, "state", "clean") ?: "clean"
            t.dirtySince = optDO(to, "dirtySince")
            t.waiterUid = optS(to, "waiterUid")
            val po = to.optJSONArray("pendingOrders")
            if (po != null) for (j in 0 until po.length()) t.pendingOrders.add(po.optString(j))
            t.cleanProgress = optD(to, "cleanProgress")
            sim.tables.add(t)
        }
    }
    o.optJSONArray("tasks")?.let { a ->
        for (i in 0 until a.length()) {
            val to = a.optJSONObject(i) ?: continue
            val seatIndices: MutableList<Int>? = if (to.has("seatIndices") && !to.isNull("seatIndices")) {
                val arr = to.optJSONArray("seatIndices")
                val out = mutableListOf<Int>()
                if (arr != null) for (j in 0 until arr.length()) out.add(arr.optInt(j))
                out
            } else null
            sim.tasks.add(
                Task(
                    id = optS(to, "id", "") ?: "", kind = optS(to, "kind", "") ?: "",
                    createdMinute = optD(to, "createdMinute"),
                    claimedBy = optS(to, "claimedBy"), tableUid = optS(to, "tableUid"),
                    customerUid = optS(to, "customerUid"), cleanTarget = optS(to, "cleanTarget"),
                    seatIndex = optIO(to, "seatIndex"), seatIndices = seatIndices,
                    stage = optS(to, "stage"),
                    waitingForSeat = optI(to, "waitingForSeat"), failed = optI(to, "failed"),
                    delay = optIO(to, "delay")
                )
            )
        }
    }
    o.optJSONArray("kitchen")?.let { a ->
        for (i in 0 until a.length()) {
            val jo = a.optJSONObject(i) ?: continue
            sim.kitchen.add(
                KitchenJob(
                    id = optS(jo, "id", "") ?: "", dishId = optS(jo, "dishId", "") ?: "",
                    tableUid = optS(jo, "tableUid", "") ?: "", customerUid = optS(jo, "customerUid", "") ?: "",
                    score = optD(jo, "score"), remaining = optD(jo, "remaining"), total = optD(jo, "total"),
                    chefUid = optS(jo, "chefUid"), started = optB(jo, "started")
                )
            )
        }
    }
    o.optJSONArray("pass")?.let { a ->
        for (i in 0 until a.length()) {
            val po = a.optJSONObject(i) ?: continue
            sim.pass.add(
                PassItem(
                    id = optS(po, "id", "") ?: "", dishId = optS(po, "dishId", "") ?: "",
                    tableUid = optS(po, "tableUid", "") ?: "", customerUid = optS(po, "customerUid", "") ?: "",
                    score = optD(po, "score"), remaining = optD(po, "remaining"), total = optD(po, "total"),
                    chefUid = optS(po, "chefUid"), started = optB(po, "started"),
                    readyAt = optD(po, "readyAt"), pickedUp = optB(po, "pickedUp")
                )
            )
        }
    }
    o.optJSONArray("complaintLog")?.let { a ->
        for (i in 0 until a.length()) {
            val co = a.optJSONObject(i) ?: continue
            sim.complaintLog.add(
                Complaint(
                    reason = optS(co, "reason", "") ?: "", type = optS(co, "type", "") ?: "",
                    day = optI(co, "day"), minute = optI(co, "minute"),
                    mood = optI(co, "mood"), wait = optI(co, "wait")
                )
            )
        }
    }
    o.optJSONArray("servedLog")?.let { a ->
        for (i in 0 until a.length()) {
            val so = a.optJSONObject(i) ?: continue
            sim.servedLog.add(
                ServedEntry(
                    dishIds = listOfStr(so.optJSONArray("dishIds")),
                    spent = optD(so, "spent"), mood = optD(so, "mood"), party = optI(so, "party")
                )
            )
        }
    }
    o.optJSONArray("visitLog")?.let { a ->
        for (i in 0 until a.length()) {
            val vo = a.optJSONObject(i) ?: continue
            sim.visitLog.add(
                VisitEntry(
                    type = optS(vo, "type", "") ?: "", enter = optD(vo, "enter"),
                    seat = optDO(vo, "seat"), order = optDO(vo, "order"), food = optDO(vo, "food"),
                    leave = optD(vo, "leave"), reason = optS(vo, "reason", "") ?: "",
                    mood = optI(vo, "mood"), spent = optD(vo, "spent"),
                    dishes = optI(vo, "dishes"), partySize = optI(vo, "partySize")
                )
            )
        }
    }
    sim.lureBoost = optD(o, "lureBoost"); sim.lureDecayMinute = optD(o, "lureDecayMinute")
    o.optJSONArray("activeEvents")?.let { a ->
        for (i in 0 until a.length()) {
            val eo = a.optJSONObject(i) ?: continue
            sim.activeEvents.add(
                ActiveEvent(
                    eventId = optS(eo, "eventId", "") ?: "", name = optS(eo, "name", "") ?: "",
                    until = optD(eo, "until"), trafficMul = optD(eo, "trafficMul", 1.0)
                )
            )
        }
    }
    sim.trafficMul = optD(o, "trafficMul", 1.0)
    sim.supplierPriceMul = optD(o, "supplierPriceMul", 1.0)
    sim.supplierPriceMulUntil = optD(o, "supplierPriceMulUntil")
    o.optJSONObject("dirt")?.let {
        sim.dirt = Dirt(optD(it, "floor"), optD(it, "restroom"))
    }
    o.optJSONObject("equipBroken")?.let {
        sim.equipBroken = EquipBroken(optB(it, "ac"), optB(it, "stove"), optB(it, "fridge"))
    }
    sim.spawnAccumulator = optD(o, "spawnAccumulator")
    sim.weather = optS(o, "weather", "sunny") ?: "sunny"
    sim.eventTimer = optD(o, "eventTimer", 180.0)
    sim.todayDishScores = listOfDouble(o.optJSONArray("todayDishScores"))
    sim.todayValueScores = listOfDouble(o.optJSONArray("todayValueScores"))
    sim.todayMoods = listOfDouble(o.optJSONArray("todayMoods"))
    sim.customersSpawned = optI(o, "customersSpawned"); sim.customersLost = optI(o, "customersLost")
    sim.lureClicks = optI(o, "lureClicks")
    sim.skippedBigParties = optI(o, "skippedBigParties"); sim.skippedBiggest = optI(o, "skippedBiggest")
    sim.closingSoon = optB(o, "closingSoon"); sim.lastOrderMinute = optI(o, "lastOrderMinute")
    sim.closingSince = optDO(o, "closingSince")
    sim.forceType = optS(o, "forceType"); sim.forceTypeLeft = optI(o, "forceTypeLeft")
    return sim
}

/** 序列化：移除執行期暫存（路徑、任務參照）以免存檔肥大或循環參照。 */
fun serialize(state: GameState): JSONObject {
    val o = JSONObject()
    o.put("version", SAVE_VERSION)
    o.put("seed", state.seed); o.put("rng", state.rng)
    o.put("day", state.day); o.put("minute", state.minute)
    putD(o, "minuteFloat", state.minuteFloat); putD(o, "absMinute", state.absMinute)
    o.put("speed", state.speed); o.put("phase", state.phase); o.put("locationId", state.locationId)
    o.put("stars", state.stars); putD(o, "fame", state.fame); putD(o, "cash", state.cash)
    o.put("uidSeq", state.uidSeq); o.put("rev", state.rev); o.put("menuLimit", state.menuLimit)
    putDO(o, "absEatDone", state.absEatDone)
    val rep = JSONObject(); putD(rep, "community", state.reputation.community)
    putD(rep, "outside", state.reputation.outside); o.put("reputation", rep)
    val st = state.settings
    val s = JSONObject()
    val fx = JSONObject()
    fx.put("pools", st.fx.pools); fx.put("shadows", st.fx.shadows); fx.put("ao", st.fx.ao)
    fx.put("vignette", st.fx.vignette); fx.put("outsideShade", st.fx.outsideShade); fx.put("shafts", st.fx.shafts)
    s.put("fx", fx)
    s.put("openMinute", st.openMinute); s.put("closeMinute", st.closeMinute)
    s.put("acTemp", st.acTemp); s.put("music", st.music)
    val od = JSONArray(); for (d in st.openDays) od.put(d)
    s.put("openDays", od)
    s.put("wallColor", st.wallColor); s.put("floorColor", st.floorColor)
    if (st.wallMat != null) s.put("wallMat", st.wallMat) else s.put("wallMat", JSONObject.NULL)
    if (st.floorMat != null) s.put("floorMat", st.floorMat) else s.put("floorMat", JSONObject.NULL)
    o.put("settings", s)
    val menu = JSONArray()
    for (m in state.menu) {
        val mo = JSONObject()
        mo.put("dishId", m.dishId); mo.put("price", m.price); mo.put("grade", m.grade)
        mo.put("taste", m.taste); mo.put("portion", m.portion); mo.put("cookTime", m.cookTime)
        mo.put("active", m.active); mo.put("sold", m.sold)
        menu.put(mo)
    }
    o.put("menu", menu)
    val stock = JSONObject(); for ((k, v) in state.stock) stock.put(k, v)
    o.put("stock", stock)
    val store = JSONObject(); for ((k, v) in state.store) store.put(k, v)
    o.put("store", store)
    val sup = JSONArray()
    for (p in state.suppliers) {
        val po = JSONObject()
        po.put("dishId", p.dishId); po.put("servings", p.servings)
        putD(po, "arriveMinute", p.arriveMinute); po.put("cost", p.cost)
        sup.put(po)
    }
    o.put("suppliers", sup)
    val staff = JSONArray(); for (p in state.staff) staff.put(staffJson(p))
    o.put("staff", staff)
    val cands = JSONArray()
    for (c in state.candidates) {
        val co = JSONObject()
        co.put("candidateId", c.candidateId); co.put("staffId", c.staffId); putD(co, "askWage", c.askWage)
        cands.put(co)
    }
    o.put("candidates", cands)
    o.put("layout", layoutJson(state.layout))
    val k = JSONObject()
    k.put("stove", state.kitchen.stove); k.put("fridge", state.kitchen.fridge); k.put("prep", state.kitchen.prep)
    o.put("kitchen", k)
    o.put("sim", simJson(state.sim))
    val stats = JSONObject()
    stats.put("today", todayJson(state.stats.today))
    val hist = JSONArray(); for (d in state.stats.history) hist.put(dailyJson(d))
    stats.put("history", hist)
    val wk = JSONArray(); for (w in state.stats.weekly) wk.put(weeklyJson(w))
    stats.put("weekly", wk)
    val mag = JSONObject()
    val rank = JSONObject()
    for ((k2, b) in state.stats.magazine.rank) rank.put(k2, magBoardJson(b))
    mag.put("rank", rank); mag.put("lastSettleDay", state.stats.magazine.lastSettleDay)
    if (state.stats.magazine.lastTotalRank != null) mag.put("lastTotalRank", state.stats.magazine.lastTotalRank)
    else mag.put("lastTotalRank", JSONObject.NULL)
    if (state.stats.magazine.bestTotalRank != null) mag.put("bestTotalRank", state.stats.magazine.bestTotalRank)
    else mag.put("bestTotalRank", JSONObject.NULL)
    mag.put("firstPlaceWeeks", state.stats.magazine.firstPlaceWeeks)
    stats.put("magazine", mag)
    val rs = JSONObject(); for ((k2, v) in state.stats.ratingsScore) putD(rs, k2, v)
    stats.put("ratingsScore", rs)
    o.put("stats", stats)
    val f = JSONObject()
    f.put("tutorialDone", state.flags.tutorialDone); f.put("annualAward", state.flags.annualAward)
    f.put("secretUnlocked", state.flags.secretUnlocked); f.put("warnedWeek", state.flags.warnedWeek)
    putD(f, "negativeCashDays", state.flags.negativeCashDays)
    val sh = JSONArray(); for (v in state.flags.starHistory) sh.put(v)
    f.put("starHistory", sh)
    f.put("annualStartDay", state.flags.annualStartDay)
    f.put("lastAckSettleDay", state.flags.lastAckSettleDay)
    o.put("flags", f)
    o.put("uiQueue", JSONArray())
    val log = JSONArray()
    for (l in state.log) {
        val lo = JSONObject()
        lo.put("day", l.day); lo.put("minute", l.minute); lo.put("text", l.text); lo.put("kind", l.kind)
        log.put(lo)
    }
    o.put("log", log)
    return o
}

/* -------------------------------------------------------------- 遷移 */

/** 遷移舊存檔（補齊缺欄位），回傳可反序列化的 JSON */
fun migrate(raw: JSONObject): JSONObject? {
    val s = raw
    s.put("version", s.optInt("version", 1))
    val sim = s.optJSONObject("sim") ?: JSONObject().also { s.put("sim", it) }
    val k = s.optJSONObject("kitchen") ?: JSONObject()
    if (!k.has("stove")) k.put("stove", 1)
    if (!k.has("fridge")) k.put("fridge", 1)
    if (!k.has("prep")) k.put("prep", 1)
    s.put("kitchen", k)
    for (key in listOf("customers", "walkers", "tables", "tasks", "kitchen", "pass", "complaintLog", "servedLog", "activeEvents")) {
        if (!sim.has(key)) sim.put(key, JSONArray())
    }
    if (!sim.has("dirt")) sim.put("dirt", JSONObject().put("floor", 0.0).put("restroom", 0.0))
    if (!sim.has("equipBroken")) {
        sim.put("equipBroken", JSONObject().put("ac", false).put("stove", false).put("fridge", false))
    }
    if (!sim.has("trafficMul")) sim.put("trafficMul", 1.0)
    if (!sim.has("supplierPriceMul")) sim.put("supplierPriceMul", 1.0)
    if (!sim.has("lureBoost")) sim.put("lureBoost", 0.0)
    if (!sim.has("weather")) sim.put("weather", "sunny")
    val stats = s.optJSONObject("stats") ?: JSONObject().also { s.put("stats", it) }
    stats.put("today", emptyTodayJson(stats.optJSONObject("today")))
    if (!stats.has("history")) stats.put("history", JSONArray())
    if (!stats.has("weekly")) stats.put("weekly", JSONArray())
    if (!stats.has("magazine")) {
        stats.put("magazine", JSONObject().put("rank", JSONObject()).put("lastSettleDay", 0))
    }
    val flags = s.optJSONObject("flags")
        ?: JSONObject().put("tutorialDone", false).put("annualAward", false)
            .put("secretUnlocked", false).put("negativeCashDays", 0.0).also { s.put("flags", it) }
    if (!flags.has("negativeCashDays")) flags.put("negativeCashDays", 0.0)
    if (!flags.has("starHistory")) flags.put("starHistory", JSONArray().put(1))
    if (!flags.has("annualStartDay")) flags.put("annualStartDay", 0)
    if (!flags.has("lastAckSettleDay")) flags.put("lastAckSettleDay", 0)
    if (!flags.has("warnedWeek")) flags.put("warnedWeek", 0)
    // v4：星級上限由 5 提高到 7，舊存檔不可能超過 5，這裡只做防禦性的夾取。
    val stars = s.optInt("stars", 1)
    s.put("stars", stars.coerceIn(1, B.MAX_STARS))
    if (!s.has("uiQueue")) s.put("uiQueue", JSONArray())
    if (!s.has("log")) s.put("log", JSONArray())
    if (!s.has("suppliers")) s.put("suppliers", JSONArray())
    if (!s.has("stock")) s.put("stock", JSONObject())
    if (!s.has("store")) s.put("store", JSONObject())
    if (!s.has("menu")) s.put("menu", JSONArray())
    if (!s.has("staff")) s.put("staff", JSONArray())
    if (!s.has("candidates")) s.put("candidates", JSONArray())
    if (!s.has("uidSeq")) s.put("uidSeq", 1000)
    val layout = s.optJSONObject("layout") ?: JSONObject().also { s.put("layout", it) }
    if (!layout.has("items")) layout.put("items", JSONArray())
    if (!layout.has("rev")) layout.put("rev", 1)
    val settings = s.optJSONObject("settings") ?: JSONObject().also { s.put("settings", it) }
    if (!settings.has("fx")) {
        settings.put(
            "fx",
            JSONObject().put("pools", true).put("shadows", false).put("ao", false)
                .put("vignette", false).put("outsideShade", false).put("shafts", false)
        )
    }
    if (!settings.has("openDays")) {
        val od = JSONArray()
        for (i in 0 until 7) od.put(true)
        settings.put("openDays", od)
    }
    val minute = s.optInt("minute", 540)
    if (!s.has("minuteFloat")) s.put("minuteFloat", minute.toDouble())
    if (!s.has("absMinute")) s.put("absMinute", (s.optInt("day", 1) * 1440 + s.optDouble("minuteFloat", 540.0)))
    s.put("version", SAVE_VERSION)
    return s
}

private fun emptyTodayJson(src: JSONObject?): JSONObject {
    val base = todayJson(TodayStat())
    if (src == null) return base
    for (key in src.keys()) base.put(key, src.get(key))
    return base
}

/* -------------------------------------------------------------- 反序列化 */

/** 反序列化（含遷移）。回傳 null 表示格式錯誤。 */
fun deserialize(raw: JSONObject): GameState? {
    val s = migrate(raw) ?: return null
    val state = GameState()
    state.version = SAVE_VERSION
    state.seed = s.optLong("seed", 1)
    state.rng = s.optLong("rng", 1)
    state.day = s.optInt("day", 1)
    state.minute = s.optInt("minute", 540)
    state.minuteFloat = optD(s, "minuteFloat", 540.0)
    state.absMinute = optD(s, "absMinute", state.day * 1440.0 + state.minuteFloat)
    state.speed = s.optInt("speed", 1)
    state.phase = optS(s, "phase", "build") ?: "build"
    state.locationId = optS(s, "locationId", "zhongli_xinming") ?: "zhongli_xinming"
    state.stars = s.optInt("stars", 1)
    state.fame = optD(s, "fame", 6.0)
    state.cash = optD(s, "cash", B.START_CASH.toDouble())
    state.uidSeq = s.optInt("uidSeq", 1000)
    state.rev = s.optInt("rev", 0)
    state.menuLimit = s.optInt("menuLimit", 8)
    state.absEatDone = optDO(s, "absEatDone")
    s.optJSONObject("reputation")?.let {
        state.reputation = Rep(optD(it, "community", B.RATING_START.toDouble()), optD(it, "outside", B.RATING_START.toDouble()))
    }
    s.optJSONObject("settings")?.let { so ->
        val st = state.settings
        so.optJSONObject("fx")?.let {
            st.fx = FxFlags(
                pools = optB(it, "pools", true), shadows = optB(it, "shadows"),
                ao = optB(it, "ao"), vignette = optB(it, "vignette"),
                outsideShade = optB(it, "outsideShade"), shafts = optB(it, "shafts")
            )
        }
        st.openMinute = optI(so, "openMinute", st.openMinute)
        st.closeMinute = optI(so, "closeMinute", st.closeMinute)
        st.acTemp = optI(so, "acTemp", st.acTemp)
        st.music = optS(so, "music", st.music) ?: st.music
        so.optJSONArray("openDays")?.let { a ->
            val list = MutableList(7) { true }
            for (i in 0 until minOf(7, a.length())) list[i] = a.optBoolean(i, true)
            st.openDays = list
        }
        st.wallColor = optS(so, "wallColor", st.wallColor) ?: st.wallColor
        st.floorColor = optS(so, "floorColor", st.floorColor) ?: st.floorColor
        st.wallMat = optS(so, "wallMat")
        st.floorMat = optS(so, "floorMat")
    }
    s.optJSONArray("menu")?.let { a ->
        for (i in 0 until a.length()) {
            val mo = a.optJSONObject(i) ?: continue
            state.menu.add(
                MenuEntry(
                    dishId = optS(mo, "dishId", "") ?: "", price = optI(mo, "price", 100),
                    grade = optI(mo, "grade", 50), taste = optI(mo, "taste", 50),
                    portion = optI(mo, "portion", 50), cookTime = optI(mo, "cookTime", 25),
                    active = optB(mo, "active", true), sold = optI(mo, "sold")
                )
            )
        }
    }
    s.optJSONObject("stock")?.let { o ->
        for (k in o.keys()) state.stock[k] = o.optInt(k)
    }
    s.optJSONObject("store")?.let { o ->
        for (k in o.keys()) state.store[k] = o.optInt(k)
    }
    s.optJSONArray("suppliers")?.let { a ->
        for (i in 0 until a.length()) {
            val po = a.optJSONObject(i) ?: continue
            state.suppliers.add(
                Supplier(
                    dishId = optS(po, "dishId", "") ?: "", servings = optI(po, "servings"),
                    arriveMinute = optD(po, "arriveMinute"), cost = optI(po, "cost")
                )
            )
        }
    }
    s.optJSONArray("staff")?.let { a ->
        for (i in 0 until a.length()) a.optJSONObject(i)?.let { state.staff.add(staffOf(it)) }
    }
    s.optJSONArray("candidates")?.let { a ->
        for (i in 0 until a.length()) {
            val co = a.optJSONObject(i) ?: continue
            state.candidates.add(
                com.dreamrestaurant.data.Candidate(
                    candidateId = optS(co, "candidateId", "") ?: "",
                    staffId = optS(co, "staffId", "") ?: "",
                    askWage = optD(co, "askWage", 2.0)
                )
            )
        }
    }
    s.optJSONObject("layout")?.let { state.layout = layoutOf(it) }
    s.optJSONObject("kitchen")?.let {
        state.kitchen = KitchenLevels(optI(it, "stove", 1), optI(it, "fridge", 1), optI(it, "prep", 1))
    }
    s.optJSONObject("sim")?.let { state.sim = simOf(it) }
    s.optJSONObject("stats")?.let { so ->
        state.stats.today = todayOf(so.optJSONObject("today"))
        so.optJSONArray("history")?.let { a ->
            for (i in 0 until a.length()) a.optJSONObject(i)?.let { state.stats.history.add(dailyOf(it)) }
        }
        so.optJSONArray("weekly")?.let { a ->
            for (i in 0 until a.length()) a.optJSONObject(i)?.let { state.stats.weekly.add(weeklyOf(it)) }
        }
        so.optJSONObject("magazine")?.let { mo ->
            state.stats.magazine.lastSettleDay = optI(mo, "lastSettleDay")
            state.stats.magazine.lastTotalRank = optIO(mo, "lastTotalRank")
            state.stats.magazine.bestTotalRank = optIO(mo, "bestTotalRank")
            state.stats.magazine.firstPlaceWeeks = optI(mo, "firstPlaceWeeks")
            mo.optJSONObject("rank")?.let { rk ->
                for (k in rk.keys()) rk.optJSONObject(k)?.let { state.stats.magazine.rank[k] = magBoardOf(it) }
            }
        }
        so.optJSONObject("ratingsScore")?.let { rs ->
            for (k in rs.keys()) state.stats.ratingsScore[k] = optD(rs, k)
        }
    }
    s.optJSONObject("flags")?.let { f ->
        state.flags.tutorialDone = optB(f, "tutorialDone")
        state.flags.annualAward = optB(f, "annualAward")
        state.flags.secretUnlocked = optB(f, "secretUnlocked")
        state.flags.warnedWeek = optI(f, "warnedWeek")
        state.flags.negativeCashDays = optD(f, "negativeCashDays")
        f.optJSONArray("starHistory")?.let { a ->
            state.flags.starHistory = mutableListOf()
            for (i in 0 until a.length()) state.flags.starHistory.add(a.optInt(i))
        }
        if (state.flags.starHistory.isEmpty()) state.flags.starHistory = mutableListOf(1)
        state.flags.annualStartDay = optI(f, "annualStartDay")
        state.flags.lastAckSettleDay = optI(f, "lastAckSettleDay")
    }
    s.optJSONArray("log")?.let { a ->
        for (i in 0 until a.length()) {
            val lo = a.optJSONObject(i) ?: continue
            state.log.add(
                LogEntry(
                    day = optI(lo, "day"), minute = optI(lo, "minute"),
                    text = optS(lo, "text", "") ?: "", kind = optS(lo, "kind", "info") ?: "info"
                )
            )
        }
    }
    state.uiQueue = mutableListOf()
    // JS 存檔會帶 layout.reach；這裡省略以縮小存檔，載入後重建。
    recomputeReachability(state.layout)
    return state
}

/* ----------------------------------------------------------- 存讀檔服務 */

class SaveManager(private val storage: SaveStorage) {

    fun save(state: GameState, slot: String, label: String = ""): ActionResult {
        val payload = JSONObject()
        payload.put("version", SAVE_VERSION)
        payload.put("savedAt", isoNow())
        payload.put("label", label)
        payload.put("state", serialize(state))
        val json = payload.toString()
        return try {
            storage.write(saveKey(slot), json)
            ActionResult.ok("存檔完成")
        } catch (err: Throwable) {
            ActionResult.fail("存檔失敗：${err.message}")
        }
    }

    fun load(slot: String): LoadResult {
        val raw = storage.read(saveKey(slot)) ?: return LoadResult(false, error = "這個槽位沒有存檔")
        return try {
            val payload = JSONObject(raw)
            val state = deserialize(payload.optJSONObject("state") ?: JSONObject())
                ?: return LoadResult(false, error = "存檔格式錯誤")
            LoadResult(
                ok = true, state = state,
                meta = SaveMeta(payload.optString("savedAt", ""), payload.optString("label", ""))
            )
        } catch (err: Throwable) {
            LoadResult(false, error = "讀檔失敗：${err.message}")
        }
    }

    fun slotInfo(slot: String): SlotInfo {
        val raw = storage.read(saveKey(slot)) ?: return SlotInfo(slot)
        return try {
            val payload = JSONObject(raw)
            val s = payload.optJSONObject("state") ?: JSONObject()
            SlotInfo(
                slot = slot,
                savedAt = payload.optString("savedAt", null),
                day = if (s.has("day")) s.optInt("day") else null,
                locationId = if (s.has("locationId")) s.optString("locationId") else null,
                cash = if (s.has("cash")) s.optDouble("cash") else null,
                stars = if (s.has("stars")) s.optInt("stars") else null,
                version = payload.optInt("version", 0)
            )
        } catch (_: Throwable) {
            SlotInfo(slot, broken = true)
        }
    }

    fun deleteSave(slot: String): Boolean {
        storage.remove(saveKey(slot))
        return true
    }

    fun listSlots(): List<SlotInfo> =
        (MANUAL_SLOTS + AUTO_SLOT).map { slotInfo(it) }

    fun hasAnySave(): Boolean =
        (MANUAL_SLOTS + AUTO_SLOT).any { storage.read(saveKey(it)) != null }

    private fun isoNow(): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("UTC")
        return fmt.format(Date())
    }
}
