package com.dreamrestaurant.ui

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import com.dreamrestaurant.sim.Layout

/**
 * 等角投影 — 與 `src/render/iso.js` 完全同一組數字。
 *
 *   px = ORIGIN_X + (x - y) * TILE_W / 2
 *   py = ORIGIN_Y + (x + y) * TILE_H / 2
 *
 * 邏輯座標系固定 1600×1000（與網頁版相同），畫到畫布時才整體縮放置中。
 */
object Iso {
    const val TILE_W = 64f
    const val TILE_H = 32f
    const val HALF_W = TILE_W / 2f
    const val HALF_H = TILE_H / 2f

    /** ORIGIN_X = round(1600 / 2 - (26 - 17) * 64 / 4) = 656 */
    const val ORIGIN_X = 656f
    /** ORIGIN_Y = round(96 * 1000 / 400) = 240 */
    const val ORIGIN_Y = 240f

    /** 牆面／傢俱的立體高度（邏輯像素），只影響取景範圍與繪圖 */
    const val WALL_H = 56f
    const val ITEM_H = 24f

    fun at(x: Float, y: Float): Offset =
        Offset(ORIGIN_X + (x - y) * HALF_W, ORIGIN_Y + (x + y) * HALF_H)

    fun at(x: Double, y: Double): Offset = at(x.toFloat(), y.toFloat())

    /**
     * 整間店（含門外人行道）在邏輯座標的外框，
     * 外擴 margin 讓牆頂、人物與門外排隊不會被裁掉。
     */
    fun contentBox(layout: Layout, margin: Float = 96f): Rect {
        val gw = layout.gridW
        val gh = layout.gridH
        val left = at(-1.5f, (gh + 1.5f).toFloat()).x
        val right = at((gw + 1.5f).toFloat(), -1.5f).x
        val top = at(-1.5f, -1.5f).y - WALL_H
        val bottom = at((gw + 1.5f).toFloat(), (gh + 1.5f).toFloat()).y
        return Rect(left - margin, top - margin, right + margin, bottom + margin)
    }

    /** 把邏輯外框塞進畫布：回傳 (scale, translate) */
    fun fit(box: Rect, canvasW: Float, canvasH: Float, pad: Float = 8f): Pair<Float, Offset> {
        val w = box.width
        val h = box.height
        if (w <= 0f || h <= 0f || canvasW <= 0f || canvasH <= 0f) return 1f to Offset.Zero
        val scale = ((canvasW - pad * 2) / w).coerceAtMost((canvasH - pad * 2) / h)
        val tx = (canvasW - w * scale) / 2f - box.left * scale
        val ty = (canvasH - h * scale) / 2f - box.top * scale
        return scale to Offset(tx, ty)
    }
}
