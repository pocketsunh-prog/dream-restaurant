package com.dreamrestaurant.core

import kotlin.math.floor

/**
 * 對齊 JavaScript 的 `Math.round`：往最接近的整數取，遇到 .5 時一律往 +∞ 進位。
 *
 * Kotlin 內建的 `kotlin.math.round` 實作是「四捨六入五成雙」（16.5→16、12.5→12），
 * 與 JS（16.5→17、12.5→13）不同，會讓模擬結果在數個 tick 後與網頁版完全分叉。
 * 因此模擬層一律改用本函式。
 */
fun round(x: Double): Double = floor(x + 0.5)

fun round(x: Float): Float = floor(x + 0.5f)
