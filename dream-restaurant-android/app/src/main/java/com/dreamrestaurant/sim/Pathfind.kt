package com.dreamrestaurant.sim

import com.dreamrestaurant.core.round

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.sign

/** 對應 src/sim/pathfind.js —— 四方向 A*，附快取 */

/** 沿路徑移動的實體（顧客／員工共用） */
interface PathEntity {
    var x: Double
    var y: Double
    var dir: String
    var frame: Double
    var path: MutableList<P>
    var pathIndex: Int
}

private class MinHeap {
    private var xs = IntArray(64)
    private var ys = IntArray(64)
    private var ks = IntArray(64)
    private var fs = IntArray(64)
    var n = 0

    private fun grow() {
        var size = xs.size * 2
        if (size > 1 shl 18) size = 1 shl 18
        val nx = IntArray(size); xs.copyInto(nx, 0, 0, n)
        val ny = IntArray(size); ys.copyInto(ny, 0, 0, n)
        val nk = IntArray(size); ks.copyInto(nk, 0, 0, n)
        val nf = IntArray(size); fs.copyInto(nf, 0, 0, n)
        xs = nx; ys = ny; ks = nk; fs = nf
    }

    fun push(x: Int, y: Int, k: Int, f: Int) {
        if (n >= xs.size) grow()
        if (n >= xs.size) return
        var i = n
        n++
        xs[i] = x; ys[i] = y; ks[i] = k; fs[i] = f
        while (i > 0) {
            val p = (i - 1) shr 1
            if (fs[p] <= fs[i]) break
            swap(p, i)
            i = p
        }
    }

    private fun swap(a: Int, b: Int) {
        var t = xs[a]; xs[a] = xs[b]; xs[b] = t
        t = ys[a]; ys[a] = ys[b]; ys[b] = t
        t = ks[a]; ks[a] = ks[b]; ks[b] = t
        t = fs[a]; fs[a] = fs[b]; fs[b] = t
    }

    class Top(val x: Int, val y: Int, val k: Int, val f: Int)

    fun pop(): Top {
        val top = Top(xs[0], ys[0], ks[0], fs[0])
        n--
        if (n > 0) {
            xs[0] = xs[n]; ys[0] = ys[n]; ks[0] = ks[n]; fs[0] = fs[n]
            var i = 0
            while (true) {
                val l = i * 2 + 1; val r = l + 1
                var m = i
                if (l < n && fs[l] < fs[m]) m = l
                if (r < n && fs[r] < fs[m]) m = r
                if (m == i) break
                swap(m, i)
                i = m
            }
        }
        return top
    }
}

private val pathCache = LinkedHashMap<String, List<P>?>(64, 0.75f, false)
private const val CACHE_LIMIT = 4000

fun clearPathCache() = pathCache.clear()

/**
 * 回傳不含起點、含終點的路徑；null 表示不可達。
 */
fun findPath(layout: Layout?, from: P?, to: P?): MutableList<P>? {
    if (layout == null || from == null || to == null) return null
    val fx = roundToInt(from.x); val fy = roundToInt(from.y)
    val tx = roundToInt(to.x); val ty = roundToInt(to.y)
    if (fx == tx && fy == ty) return mutableListOf()
    val rev = layout.rev
    val key = "$rev|$fx,$fy>$tx,$ty"
    val hit = pathCache[key]
    if (hit != null) return hit.map { P(it.x, it.y) }.toMutableList()

    // astar(layout, goalX, goalY, startX, startY)
    val result = astar(layout, tx, ty, fx, fy)
    if (pathCache.size > CACHE_LIMIT) pathCache.clear()
    pathCache[key] = result
    return result?.map { P(it.x, it.y) }?.toMutableList()
}

private fun roundToInt(v: Double): Int = round(v).toInt()

private fun astar(layout: Layout, fx: Int, fy: Int, sx: Int, sy: Int): MutableList<P>? {
    var gx = fx
    var gy = fy
    val gridW = layout.gridW
    if (!isWalkableTile(layout, gx, gy)) {
        val alt = listOf(intArrayOf(0, 1), intArrayOf(0, -1), intArrayOf(1, 0), intArrayOf(-1, 0))
            .map { intArrayOf(gx + it[0], gy + it[1]) }
            .filter { isWalkableTile(layout, it[0], it[1]) }
        if (alt.isEmpty()) return null
        gx = alt[0][0]; gy = alt[0][1]
        if (sx == gx && sy == gy) return mutableListOf()
    }
    if (!isWalkableTile(layout, sx, sy)) return null

    fun h(x: Int, y: Int) = abs(x - gx) + abs(y - gy)

    val open = MinHeap()
    val gScore = HashMap<Int, Int>()
    val came = HashMap<Int, Int>()
    val startKey = sy * gridW + sx
    gScore[startKey] = 0
    open.push(sx, sy, startKey, h(sx, sy))
    val goalKey = gy * gridW + gx
    val closed = HashSet<Int>()
    var guard = 0

    val dxs = intArrayOf(1, -1, 0, 0)
    val dys = intArrayOf(0, 0, 1, -1)

    while (open.n > 0) {
        if (++guard > 6000) break
        val cur = open.pop()
        if (closed.contains(cur.k)) continue
        closed.add(cur.k)
        if (cur.k == goalKey) {
            val path = mutableListOf<P>()
            var k = cur.k
            while (k != startKey) {
                path.add(P(k % gridW, floor(k / gridW.toDouble()).toInt()))
                k = came[k] ?: return null
            }
            path.reverse()
            return path
        }
        val curG = gScore[cur.k] ?: Int.MAX_VALUE
        for (d in 0 until 4) {
            val nx = cur.x + dxs[d]; val ny = cur.y + dys[d]
            if (!isWalkableTile(layout, nx, ny)) continue
            val nk = ny * gridW + nx
            if (closed.contains(nk)) continue
            val tentative = (if (curG == Int.MAX_VALUE) 0 else curG) + 1
            val prev = gScore[nk] ?: Int.MAX_VALUE
            if (tentative < prev) {
                gScore[nk] = tentative
                came[nk] = cur.k
                open.push(nx, ny, nk, tentative + h(nx, ny))
            }
        }
    }
    return null
}

/** 用於除錯／繪製：兩格之間的直線距離 */
fun tileDistance(a: P, b: P): Double = abs(a.x - b.x) + abs(a.y - b.y)

class Advance(val x: Double, val y: Double, val index: Int, val arrived: Boolean, val dir: String?)

/** 沿路徑前進，回傳新的位置與 index；arrived 表示是否抵達終點 */
fun advanceAlong(
    path: List<P>,
    index: Int,
    x: Double,
    y: Double,
    step: Double,
    dirOf: (Double, Double) -> String
): Advance {
    var idx = index
    var px = x
    var py = y
    var remain = step
    var dir: String? = null
    while (remain > 0 && idx < path.size) {
        val node = path[idx]
        val dx = node.x - px
        val dy = node.y - py
        val dist = abs(dx) + abs(dy)
        if (dist <= remain) {
            if (dist > 0) dir = dirOf(node.x - px, node.y - py)
            px = node.x; py = node.y
            remain -= dist
            idx++
        } else {
            dir = dirOf(dx, dy)
            px += sign(dx) * remain
            py += sign(dy) * remain
            remain = 0.0
        }
    }
    return Advance(px, py, idx, idx >= path.size, dir)
}

fun dirFromDelta(dx: Double, dy: Double): String {
    if (abs(dx) > abs(dy)) return if (dx > 0) "E" else "W"
    if (dy != 0.0) return if (dy > 0) "S" else "N"
    return "S"
}
