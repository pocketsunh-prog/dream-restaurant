package com.dreamrestaurant.core

import kotlin.math.floor

/** 決定性亂數（mulberry32），狀態可序列化 —— 對應 src/core/rng.js */
class Rng(seedIn: Long) {
    var seed: Int = 0
    private var s: Int = 0

    init {
        val base = (floor(seedIn.toDouble()).toLong() and 0xFFFFFFFFL).let { if (it == 0L) 1L else it }
        seed = base.toInt()
        s = seed
    }

    /** 0..1（不含 1） */
    fun next(): Double {
        s = s + 0x6D2B79F5
        var t = s
        t = (t xor (t ushr 15)) * (t or 1)
        t = t xor (t + ((t xor (t ushr 7)) * (t or 61)))
        return ((t xor (t ushr 14)).toUInt().toLong()).toDouble() / 4294967296.0
    }

    /** 含頭含尾 */
    fun int(a: Int, b: Int = 0): Int {
        var lo = a
        var hi = b
        if (hi < lo) { val tmp = lo; lo = hi; hi = tmp }
        return lo + floor(next() * (hi - lo + 1)).toInt()
    }

    fun range(a: Double, b: Double): Double = a + next() * (b - a)

    fun <T> pick(arr: List<T>?): T? {
        if (arr == null || arr.isEmpty()) return null
        return arr[floor(next() * arr.size).toInt()]
    }

    fun chance(p: Double): Boolean = next() < p

    fun <T> shuffle(arr: List<T>): List<T> {
        val out = arr.toMutableList()
        var i = out.size - 1
        while (i > 0) {
            val j = floor(next() * (i + 1)).toInt()
            val t = out[i]; out[i] = out[j]; out[j] = t
            i--
        }
        return out
    }

    fun <T> weighted(list: List<WT<T>>): T? {
        if (list.isEmpty()) return null
        var total = 0.0
        for (it in list) total += it.w.coerceAtLeast(0.0)
        if (total <= 0) return list[0].v
        var roll = next() * total
        for (it in list) {
            roll -= it.w.coerceAtLeast(0.0)
            if (roll <= 0) return it.v
        }
        return list[list.size - 1].v
    }

    /** 給 Map<String, Double> 用的加權挑選（保持插入順序 = JS Object.entries） */
    fun <T> weightedPairs(pairs: List<Pair<T, Double>>): T? =
        weighted(pairs.map { WT(it.first, it.second) })

    fun getState(): Long = s.toUInt().toLong()

    fun setState(v: Long) {
        val x = v and 0xFFFFFFFFL
        s = if (x == 0L) 1 else x.toInt()
    }

    fun fork(): Rng = Rng(getState())

    companion object {
        fun newSeed(): Long {
            val v = (Math.random() * 0xFFFFFFFFL).toLong() and 0xFFFFFFFFL
            return if (v == 0L) 1L else v
        }
    }
}

data class WT<T>(val v: T, val w: Double)

/** 以 state.rng 執行 fn，結束後把新狀態寫回（同 seed 同結果） */
inline fun <T> withRng(state: GameState, fn: (Rng) -> T): T {
    val rng = Rng(state.seed)
    rng.setState(state.rng)
    return try {
        fn(rng)
    } finally {
        state.rng = rng.getState()
    }
}
