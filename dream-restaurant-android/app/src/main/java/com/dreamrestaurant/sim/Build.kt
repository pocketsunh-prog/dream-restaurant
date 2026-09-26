package com.dreamrestaurant.sim

import com.dreamrestaurant.core.B
import com.dreamrestaurant.data.FurnitureDef
import com.dreamrestaurant.data.furnitureByCategory
import com.dreamrestaurant.data.furnitureById
import kotlin.math.max
import kotlin.math.min
import com.dreamrestaurant.core.round

/** 對應 src/sim/build.js */

class P(var x: Double, var y: Double) {
    constructor(x: Int, y: Int) : this(x.toDouble(), y.toDouble())
    fun i(): P = P(round(x), round(y))
}

class Sidewalk(var y: Double, var x0: Int, var x1: Int)

class Item(
    var uid: String,
    var typeId: String,
    var x: Int,
    var y: Int,
    var w: Int,
    var h: Int,
    var rot: Int = 0,
    var durability: Int = 100,
    var broken: Boolean = false,
    var chairUids: MutableList<String>? = null,
    var chairFor: String? = null,
    var tableUid: String? = null,
    var autoChair: Boolean = false,
    var rotManual: Boolean = false,
    var rotAuto: Int? = null,
    var chairTypeId: String? = null
)

class Seat(
    var x: Int,
    var y: Int,
    var facing: String,
    var chair: Boolean = false,
    var reachDoor: Boolean = true,
    var reachPass: Boolean = true
)

class TableState(
    var uid: String,
    var itemUid: String,
    var x: Int,
    var y: Int,
    var w: Int,
    var h: Int,
    var name: String,
    var seats: MutableList<Seat>,
    var usable: Boolean,
    var serviceTile: Seat?,
    var occupants: MutableList<String> = mutableListOf(),
    var state: String = "clean",
    var dirtySince: Double? = null,
    var waiterUid: String? = null,
    var pendingOrders: MutableList<String> = mutableListOf(),
    var cleanProgress: Double = 0.0
)

class Layout {
    var gridW: Int = B.GRID_W
    var gridH: Int = B.GRID_H
    var tiles: MutableList<String> = mutableListOf()
    var items: MutableList<Item> = mutableListOf()
    var door: P = P(0, 0)
    var outside: P = P(0.0, 0.0)
    var kitchenTiles: MutableList<P> = mutableListOf()
    var passTiles: MutableList<P> = mutableListOf()
    var restroomTiles: MutableList<P> = mutableListOf()
    var restroom: P? = null
    var sidewalk: Sidewalk = Sidewalk(0.0, 1, 1)
    var rev: Int = 1
    var reach: IntArray? = null
    var reachFromPass: IntArray? = null

    /** JS 的 {...layout, rev: n}：其餘欄位共用參考 */
    fun copyWithRev(next: Int): Layout {
        val c = Layout()
        c.gridW = gridW; c.gridH = gridH; c.tiles = tiles; c.items = items
        c.door = door; c.outside = outside
        c.kitchenTiles = kitchenTiles; c.passTiles = passTiles; c.restroomTiles = restroomTiles
        c.restroom = restroom; c.sidewalk = sidewalk
        c.rev = next; c.reach = reach; c.reachFromPass = reachFromPass
        return c
    }
}

private data class Variant(
    val doorX: Int,
    val kx0: Int, val ky0: Int, val kx1: Int, val ky1: Int,
    val restroom: String,
    val partitions: List<Pair<Int, Int>>,
    val items: List<Spot> = emptyList()
)

private data class Spot(val typeId: String, val x: Int, val y: Int, val rot: Int = 0)

private val LAYOUT_VARIANTS = mapOf(
    "zhongli_xinming" to Variant(12, 1, 1, 8, 4, "NE", emptyList()),
    "keelung_miaokou" to Variant(14, 1, 1, 9, 4, "NW", emptyList()),
    "taipei_nanyang" to Variant(8, 1, 1, 7, 5, "SE", listOf(18 to 8, 18 to 9, 18 to 10)),
    "taichung_zhonghua" to Variant(17, 1, 1, 11, 3, "NE", listOf(14 to 10, 14 to 11)),
    "tainan_dongdi" to Variant(10, 1, 1, 8, 5, "SE", emptyList()),
    "kaohsiung_xinkujiang" to Variant(18, 1, 1, 9, 4, "NW", listOf(16 to 5, 16 to 6)),
    "yilan_luodong" to Variant(5, 1, 1, 8, 4, "SE", listOf(20 to 9, 20 to 10), listOf(Spot("table_8b", 5, 6))),
    "chiayi_wenhua" to Variant(11, 1, 1, 10, 4, "SE", listOf(13 to 13, 14 to 13), listOf(Spot("table_8b", 5, 6))),
    "changhua_baguashan" to Variant(15, 1, 1, 12, 3, "NE", listOf(15 to 8, 15 to 9), listOf(Spot("table_8b", 5, 6))),
    "hualien_dongdamen" to Variant(19, 1, 1, 9, 5, "SE", emptyList(), listOf(Spot("table_8b", 5, 6))),
    "tainan_anping" to Variant(21, 1, 1, 11, 4, "NW", listOf(6 to 8), listOf(Spot("table_8b", 5, 6))),
    "hsinchu_science_park" to Variant(13, 1, 1, 11, 4, "SE", listOf(22 to 6), listOf(Spot("table_8b", 5, 6))),
    "pingtung_kenting" to Variant(8, 1, 1, 10, 5, "NW", listOf(19 to 12, 19 to 13), listOf(Spot("table_8b", 5, 6))),
    "penghu_magong" to Variant(15, 1, 1, 12, 4, "NE", emptyList(), listOf(Spot("table_8b", 5, 6)))
)

private val DEFAULT_VARIANT = LAYOUT_VARIANTS.getValue("zhongli_xinming")

fun tileIndex(layout: Layout, x: Int, y: Int): Int = y * layout.gridW + x

fun inBounds(layout: Layout, x: Int, y: Int): Boolean =
    x >= 0 && y >= 0 && x < layout.gridW && y < layout.gridH

fun tileAt(layout: Layout, x: Int, y: Int): String {
    if (!inBounds(layout, x, y)) return "void"
    return layout.tiles.getOrElse(tileIndex(layout, x, y)) { "void" }
}

fun setTile(layout: Layout, x: Int, y: Int, type: String): Boolean {
    if (!inBounds(layout, x, y)) return false
    layout.tiles[tileIndex(layout, x, y)] = type
    return true
}

fun defaultLayout(locationId: String, nextUid: ((Any?) -> String)? = null): Layout {
    val v = LAYOUT_VARIANTS[locationId] ?: DEFAULT_VARIANT
    val gridW = B.GRID_W
    val gridH = B.GRID_H
    val tiles = MutableList(gridW * gridH) { "floor" }
    val layout = Layout()
    layout.gridW = gridW
    layout.gridH = gridH
    layout.tiles = tiles
    layout.items = mutableListOf()
    layout.door = P(v.doorX, gridH - 1)
    layout.outside = P(v.doorX.toDouble(), gridH.toDouble() - 0.5)
    layout.sidewalk = Sidewalk((gridH).toDouble() - 0.5, 1, gridW - 2)

    fun put(x: Int, y: Int, t: String) {
        if (inBounds(layout, x, y)) tiles[y * gridW + x] = t
    }

    for (x in 0 until gridW) { put(x, 0, "wall"); put(x, gridH - 1, "wall") }
    for (y in 0 until gridH) { put(0, y, "wall"); put(gridW - 1, y, "wall") }

    for (y in v.ky0..v.ky1) {
        for (x in v.kx0..v.kx1) {
            put(x, y, "kitchen")
            layout.kitchenTiles.add(P(x, y))
        }
    }

    val passXs = mutableListOf<Int>()
    var x = v.kx0 + 2
    while (x <= v.kx1 - 1) { passXs.add(x); x += 3 }
    if (passXs.isEmpty()) passXs.add(v.kx0)
    for (px in passXs) {
        put(px, v.ky1 + 1, "pass")
        layout.passTiles.add(P(px, v.ky1 + 1))
    }

    val rw = 2
    val rh = 2
    var rx = gridW - 1 - rw
    var ry = 1
    if (v.restroom == "NW") { rx = 1 + (v.kx1 - v.kx0) + 2; ry = 1 }
    if (v.restroom == "NE") { rx = gridW - 1 - rw; ry = 1 }
    if (v.restroom == "SE") { rx = gridW - 1 - rw; ry = gridH - 1 - rh }
    for (y in ry until ry + rh) {
        for (xx in rx until rx + rw) {
            if (tileAt(layout, xx, y) == "floor") {
                put(xx, y, "restroom")
                layout.restroomTiles.add(P(xx, y))
            }
        }
    }
    layout.restroom = layout.restroomTiles.firstOrNull()?.let { P(it.x, it.y) }

    for ((px, py) in v.partitions) {
        if (tileAt(layout, px, py) == "floor") put(px, py, "wall")
    }

    put(layout.door.x.toInt(), layout.door.y.toInt(), "door")

    if (v.items.isNotEmpty()) {
        val helper = Layout()
        helper.gridW = gridW; helper.gridH = gridH; helper.tiles = tiles; helper.items = layout.items
        var seq = 0
        for (spot in v.items) {
            val def = furnitureById(spot.typeId) ?: continue
            val sx = spot.x
            val sy = spot.y
            if (!canPlace(layout, def.id, sx, sy).ok) continue
            seq += 1
            val item = Item("l${seq}_$locationId", def.id, sx, sy, def.w, def.h, spot.rot, 100, false)
            layout.items.add(item)
            if (def.category == "table") {
                val gen = nextUid ?: { _: Any? -> "lx${seq}" }
                item.chairUids = autoPlaceChairs(helper, item, gen).toMutableList()
            }
        }
    }

    recomputeReachability(layout)
    return layout
}

fun itemFootprint(item: Item?, def: FurnitureDef?): Pair<Int, Int> {
    val d = def ?: furnitureById(item?.typeId)
    var w = max(1, round((item?.w ?: d?.w ?: 1).toDouble()).toInt())
    var h = max(1, round((item?.h ?: d?.h ?: 1).toDouble()).toInt())
    val rot = ((round((item?.rot ?: 0).toDouble()).toInt() % 4) + 4) % 4
    val dw = max(1, round((d?.w ?: 1).toDouble()).toInt())
    val dh = max(1, round((d?.h ?: 1).toDouble()).toInt())
    if (dw != dh && rot % 2 == 1 && w == dw && h == dh) { val t = w; w = h; h = t }
    return w to h
}

fun blockingItemAt(layout: Layout, x: Int, y: Int): Item? {
    for (item in layout.items) {
        val def = furnitureById(item.typeId)
        val (w, h) = itemFootprint(item, def)
        if (x >= item.x && x < item.x + w && y >= item.y && y < item.y + h) {
            if (def?.blocks == true) return item
        }
    }
    return null
}

fun itemAt(layout: Layout, x: Int, y: Int): Item? {
    for (item in layout.items) {
        val def = furnitureById(item.typeId)
        val (w, h) = itemFootprint(item, def)
        if (x >= item.x && x < item.x + w && y >= item.y && y < item.y + h) return item
    }
    return null
}

fun isOccupied(layout: Layout, x: Int, y: Int, ignoreUid: String? = null): Item? {
    for (item in layout.items) {
        if (ignoreUid != null && item.uid == ignoreUid) continue
        val def = furnitureById(item.typeId)
        val (w, h) = itemFootprint(item, def)
        if (x >= item.x && x < item.x + w && y >= item.y && y < item.y + h) return item
    }
    return null
}

fun isWalkableTile(layout: Layout, x: Int, y: Int): Boolean {
    val t = tileAt(layout, x, y)
    if (t != "floor" && t != "door" && t != "pass" && t != "restroom") return false
    return blockingItemAt(layout, x, y) == null
}

fun recomputeReachability(layout: Layout) {
    val total = layout.gridW * layout.gridH
    val reach = IntArray(total)
    val fromPass = IntArray(total)
    val gx = layout.gridW
    val gy = layout.gridH

    fun flood(starts: List<P>, out: IntArray) {
        val queue = ArrayDeque<P>()
        for (s in starts) {
            val sx = s.x.toInt()
            val sy = s.y.toInt()
            if (!isWalkableTile(layout, sx, sy)) {
                val alt = listOf(P(sx, sy - 1), P(sx - 1, sy), P(sx + 1, sy), P(sx, sy + 1))
                    .firstOrNull { isWalkableTile(layout, it.x.toInt(), it.y.toInt()) }
                if (alt == null) continue
                val ai = alt.y.toInt() * gx + alt.x.toInt()
                if (out[ai] == 0) { out[ai] = 1; queue.add(P(alt.x.toInt(), alt.y.toInt())) }
                continue
            }
            val k = sy * gx + sx
            if (out[k] == 0) { out[k] = 1; queue.add(P(sx, sy)) }
        }
        while (queue.isNotEmpty()) {
            val cur = queue.removeFirst()
            val x = cur.x.toInt()
            val y = cur.y.toInt()
            for ((dx, dy) in listOf(1 to 0, -1 to 0, 0 to 1, 0 to -1)) {
                val nx = x + dx
                val ny = y + dy
                if (nx < 0 || ny < 0 || nx >= gx || ny >= gy) continue
                val kk = ny * gx + nx
                if (out[kk] != 0) continue
                if (!isWalkableTile(layout, nx, ny)) continue
                out[kk] = 1
                queue.add(P(nx, ny))
            }
        }
    }

    flood(listOf(layout.door), reach)
    flood(if (layout.passTiles.isNotEmpty()) layout.passTiles else listOf(P(1, 1)), fromPass)
    layout.reach = reach
    layout.reachFromPass = fromPass
}

fun isReachable(layout: Layout, x: Int, y: Int, from: String = "door"): Boolean {
    var m = if (from == "pass") layout.reachFromPass else layout.reach
    if (m == null) { recomputeReachability(layout); m = if (from == "pass") layout.reachFromPass else layout.reach }
    if (!inBounds(layout, x, y)) return false
    val arr = m ?: return false
    return arr[y * layout.gridW + x] != 0
}

fun reachableSeatCount(layout: Layout): Int {
    var count = 0
    for (table in computeTables(layout)) {
        for (s in table.seats) {
            if (s.reachDoor && s.reachPass) count += 1
        }
    }
    return count
}

class PlaceResult(val ok: Boolean, val error: String? = null)

fun canPlace(layout: Layout, typeId: String, x: Int, y: Int, ignoreUid: String? = null): PlaceResult {
    val def = furnitureById(typeId) ?: return PlaceResult(false, "沒有這件傢俱")
    val w = def.w
    val h = def.h
    if (x < 0 || y < 0 || x + w > layout.gridW || y + h > layout.gridH) {
        return PlaceResult(false, "超出餐廳範圍")
    }
    val wallMount = def.category == "equipment"
    for (i in 0 until w) {
        for (j in 0 until h) {
            val tx = x + i
            val ty = y + j
            val t = tileAt(layout, tx, ty)
            if (wallMount) {
                if (t != "wall" && t != "floor") return PlaceResult(false, "設備只能裝在牆面或空地上")
            } else if (t != "floor") {
                return PlaceResult(false, "只能擺在用餐區地板上")
            }
            val occ = isOccupied(layout, tx, ty, ignoreUid)
            if (occ != null) return PlaceResult(false, "這個位置已經有東西了")
        }
    }
    if (def.blocks) {
        val before = reachableSeatCount(layout)
        val fake = Item("__tmp__", typeId, x, y, w, h)
        layout.items.add(fake)
        recomputeReachability(layout)
        val after = reachableSeatCount(layout)
        layout.items.removeAt(layout.items.size - 1)
        recomputeReachability(layout)
        if (after < before) {
            return PlaceResult(false, "這樣擺會擋住動線，客人進不來或服務生走不到出餐口")
        }
        if (before == 0 && after == 0 && def.category == "table") {
            return PlaceResult(false, "這張桌子客人走不到，換個位置吧")
        }
    }
    return PlaceResult(true)
}

fun findAutoPlace(layout: Layout, typeId: String): P? {
    val def = furnitureById(typeId) ?: return null
    val wallsFirst = def.category == "equipment"
    val order = mutableListOf<P>()
    for (y in 1 until layout.gridH - 1) {
        for (x in 1 until layout.gridW - 1) order.add(P(x, y))
    }
    if (wallsFirst) {
        order.sortBy { p -> if (tileAt(layout, p.x.toInt(), p.y.toInt()) == "wall") 0 else 1 }
    }
    for (p in order) {
        if (canPlace(layout, typeId, p.x.toInt(), p.y.toInt()).ok) return p
    }
    return null
}

private fun isWalkableTileSimple(layout: Layout, x: Int, y: Int): Boolean {
    if (x < 0 || y < 0 || x >= layout.gridW || y >= layout.gridH) return false
    val t = layout.tiles[y * layout.gridW + x]
    if (t != "floor") return false
    return blockingItemAt(layout, x, y) == null
}

fun computeTables(layout: Layout): MutableList<TableState> {
    val tables = mutableListOf<TableState>()
    val claimed = mutableSetOf<String>()

    for (item in layout.items) {
        val def = furnitureById(item.typeId) ?: continue
        if (def.category != "table") continue
        val w = item.w
        val h = item.h
        val seats = mutableListOf<Seat>()

        val chairUids = item.chairUids ?: emptyList()
        for (uid in chairUids) {
            val chair = layout.items.firstOrNull { it.uid == uid } ?: continue
            val key = "${chair.x},${chair.y}"
            if (key in claimed) continue
            if (!isWalkableTileSimple(layout, chair.x, chair.y)) continue
            val cx = item.x + w / 2.0
            val cy = item.y + h / 2.0
            val dx = chair.x - cx
            val dy = chair.y - cy
            val facing = if (kotlin.math.abs(dx) > kotlin.math.abs(dy)) {
                if (dx > 0) "E" else "W"
            } else {
                if (dy > 0) "S" else "N"
            }
            claimed.add(key)
            seats.add(Seat(chair.x, chair.y, facing, true))
        }

        if (seats.size < def.seats) {
            val side = listOf(0 to -1 to "S", 0 to 1 to "N", -1 to 0 to "E", 1 to 0 to "W")
            for ((dd, f) in side) {
                val (ddx, ddy) = dd
                for (i in 0 until w) {
                    if (seats.size >= def.seats) break
                    for (j in 0 until h) {
                        if (seats.size >= def.seats) break
                        val tx = item.x + i + ddx
                        val ty = item.y + j + ddy
                        val key = "$tx,$ty"
                        if (key in claimed) continue
                        if (!isWalkableTileSimple(layout, tx, ty)) continue
                        claimed.add(key)
                        seats.add(Seat(tx, ty, f, false))
                    }
                }
            }
        }

        val maxSeats = min(def.seats, seats.size)
        val finalSeats = mutableListOf<Seat>()
        for (idx in 0 until maxSeats) {
            val c = seats[idx]
            claimed.add("${c.x},${c.y}")
            c.reachDoor = isReachable(layout, c.x, c.y, "door")
            c.reachPass = isReachable(layout, c.x, c.y, "pass")
            finalSeats.add(c)
        }

        tables.add(
            TableState(
                uid = item.uid,
                itemUid = item.uid,
                x = item.x, y = item.y, w = w, h = h,
                name = def.name,
                seats = finalSeats,
                usable = finalSeats.isNotEmpty() && finalSeats.any { it.reachDoor && it.reachPass },
                serviceTile = finalSeats.firstOrNull { it.reachPass } ?: finalSeats.firstOrNull()
            )
        )
    }
    return tables
}

class DecorResult(val total: Int, val avg: Int, val matched: Int, val count: Int)

fun decorScore(layout: Layout, location: com.dreamrestaurant.data.LocationDef?): DecorResult {
    var total = 0.0
    var matched = 0
    var count = 0
    val style = location?.decorStyle
    for (item in layout.items) {
        val def = furnitureById(item.typeId) ?: continue
        val base = def.decorScore
        var mul = 1.0
        if (style != null && def.style.isNotEmpty()) {
            if (def.style == style) { mul = 1.35; matched++ } else if (def.style == "plain") mul = 1.0 else mul = 0.8
        }
        val wear = 0.6 + 0.4 * (max(0, item.durability) / 100.0)
        total += base * mul * wear
        count++
    }
    val avg = if (count > 0) total / count else 0.0
    return DecorResult(total = total.toInt(), avg = avg.toInt(), matched = matched, count = count)
}

fun seatCount(tables: List<TableState>): Int =
    tables.sumOf { if (it.usable) it.seats.size else 0 }

fun totalSeatCount(tables: List<TableState>): Int = tables.sumOf { it.seats.size }

fun layoutValue(layout: Layout): Int {
    var v = 0
    for (item in layout.items) v += furnitureById(item.typeId)?.price ?: 0
    return v
}

fun countBroken(layout: Layout): Int = layout.items.count { it.broken }

fun repairableItems(layout: Layout): List<Item> = layout.items.filter { it.durability < 60 || it.broken }

fun findItem(layout: Layout, uid: String?): Item? = layout.items.firstOrNull { it.uid == uid }

private fun tableAt(layout: Layout, x: Int, y: Int): Boolean = layout.items.any {
    val d = furnitureById(it.typeId) ?: return@any false
    if (d.category != "table") return@any false
    x >= it.x && x < it.x + it.w && y >= it.y && y < it.y + it.h
}

fun orientChairs(layout: Layout) {
    val neighbours = listOf(0 to -1 to "N", 0 to 1 to "S", -1 to 0 to "W", 1 to 0 to "E")
    for (item in layout.items) {
        val def = furnitureById(item.typeId)
        if (def?.category != "chair" || item.rotManual) { item.rotAuto = null; continue }
        val hit = neighbours.firstOrNull { tableAt(layout, item.x + it.first.first, item.y + it.first.second) }
        item.rotAuto = if (hit != null) dirToRot(hit.second) else null
    }
}

private fun dirToRot(dir: String): Int = when (dir) {
    "S" -> 0; "E" -> 1; "N" -> 2; else -> 3
}

fun chairOwnerUid(item: Item?): String? {
    if (item == null) return null
    if (!item.tableUid.isNullOrEmpty()) return item.tableUid
    if (!item.chairFor.isNullOrEmpty()) return item.chairFor
    return null
}

fun isAutoChair(item: Item?): Boolean {
    if (item == null) return false
    if (item.autoChair) return true
    return item.typeId == "autochair" || item.typeId == "autoChair"
}

fun clearOrphanChairs(layout: Layout): Int {
    val uids = layout.items.mapNotNull { it?.uid }.toSet()
    val orphans = layout.items.filter { isAutoChair(it) && chairOwnerUid(it)?.let { o -> o !in uids } == true }
    if (orphans.isEmpty()) return 0
    val drop = orphans.map { it.uid }.toSet()
    layout.items.removeAll { it.uid in drop }
    return drop.size
}

fun syncFootprints(layout: Layout): Int {
    var fixed = 0
    for (item in layout.items) {
        val def = furnitureById(item.typeId) ?: continue
        if (def.w == def.h) continue
        val rot = ((round((item.rot).toDouble()).toInt() % 4) + 4) % 4
        if (rot % 2 == 0) continue
        val w = max(1, round((item.w).toDouble()).toInt())
        val h = max(1, round((item.h).toDouble()).toInt())
        if (w == def.w && h == def.h) { item.w = h; item.h = w; fixed++ }
    }
    return fixed
}

fun rebuildTables(state: com.dreamrestaurant.core.GameState): List<TableState> {
    val layout = state.layout
    clearOrphanChairs(layout)
    syncFootprints(layout)
    recomputeReachability(layout)
    orientChairs(layout)
    val next = computeTables(layout)
    val prev = state.sim.tables.associateBy { it.uid }
    for (t in next) {
        val old = prev[t.uid]
        if (old != null) {
            t.occupants = old.occupants
            t.state = old.state
            t.dirtySince = old.dirtySince
            t.waiterUid = old.waiterUid
            t.pendingOrders = old.pendingOrders
            t.cleanProgress = old.cleanProgress
        }
    }
    state.sim.tables = next
    state.layout.reach = layout.reach
    state.layout.reachFromPass = layout.reachFromPass
    return next
}

fun tableNeighborSpots(layout: Layout, item: Item): MutableList<Seat> {
    val def = furnitureById(item.typeId)
    val w = item.w
    val h = item.h
    val spots = mutableListOf<Seat>()
    val sideDirs = listOf(
        Triple(0, -1, "S"), Triple(0, 1, "N"), Triple(-1, 0, "E"), Triple(1, 0, "W")
    )
    val seen = mutableSetOf<String>()
    for ((ddx, ddy, facing) in sideDirs) {
        for (i in 0 until w) {
            for (j in 0 until h) {
                val tx = item.x + i + ddx
                val ty = item.y + j + ddy
                val key = "$tx,$ty"
                if (key in seen) continue
                seen.add(key)
                if (isFloorFree(layout, tx, ty, item.uid)) spots.add(Seat(tx, ty, facing, false))
            }
        }
    }
    def ?: return spots
    return spots
}

private fun isFloorFree(layout: Layout, x: Int, y: Int, selfUid: String): Boolean {
    if (x < 0 || y < 0 || x >= layout.gridW || y >= layout.gridH) return false
    val t = layout.tiles[y * layout.gridW + x]
    if (t != "floor") return false
    for (it in layout.items) {
        if (it.uid == selfUid) continue
        val (iw, ih) = itemFootprint(it, furnitureById(it.typeId))
        if (x >= it.x && x < it.x + iw && y >= it.y && y < it.y + ih) return false
    }
    return true
}

fun autoPlaceChairs(state: Any, tableItem: Item, nextUid: (Any?) -> String): List<String> {
    val layout: Layout = when (state) {
        is Layout -> state
        is com.dreamrestaurant.core.GameState -> state.layout
        else -> throw IllegalArgumentException("autoPlaceChairs needs layout or state")
    }
    val def = furnitureById(tableItem.typeId)
    val maxSeats = def?.seats ?: 2
    val spots = tableNeighborSpots(layout, tableItem)
    val count = min(maxSeats, spots.size)
    val chairDef = furnitureByCategory("chair").firstOrNull() ?: return emptyList()
    if (count <= 0) return emptyList()
    val chairId = tableItem.chairTypeId ?: chairDef.id
    val uids = mutableListOf<String>()
    for (i in 0 until count) {
        val spot = spots[i]
        val uid = nextUid(state)
        layout.items.add(
            Item(
                uid = uid, typeId = chairId, x = spot.x, y = spot.y, w = 1, h = 1,
                rot = 0, durability = 100, broken = false,
                autoChair = true, chairFor = tableItem.uid, tableUid = tableItem.uid
            )
        )
        uids.add(uid)
    }
    return uids
}

fun nearestWalkable(layout: Layout, x: Int, y: Int, maxRadius: Int = 6): P? {
    if (isWalkableTile(layout, x, y)) return P(x, y)
    for (r in 1..maxRadius) {
        for (dx in -r..r) {
            for (dy in -r..r) {
                if (kotlin.math.abs(dx) != r && kotlin.math.abs(dy) != r) continue
                val nx = x + dx
                val ny = y + dy
                if (isWalkableTile(layout, nx, ny)) return P(nx, ny)
            }
        }
    }
    return null
}
