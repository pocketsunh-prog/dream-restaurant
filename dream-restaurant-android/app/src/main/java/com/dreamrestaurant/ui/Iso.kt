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

    /**
     * 房間剪影（地板菱形 ∪ 牆面）6 邊形，供燈光／天氣裁切使用 — 對應 `iso.js` 的 `roomSilhouette`。
     * 順序：左角（牆頂）→ 屋脊 → 右角（牆頂）→ 地板東角 → 地板南角 → 地板西角。
     */
    fun roomSilhouette(gw: Int, gh: Int): List<Offset> {
        val w = gw.coerceAtLeast(1)
        val h = gh.coerceAtLeast(1)
        val r0 = Offset(ORIGIN_X - h * HALF_W, ORIGIN_Y + (h - 1) * HALF_H - WALL_H)
        val r1 = Offset(ORIGIN_X, ORIGIN_Y - HALF_H - WALL_H)
        val r2 = Offset(ORIGIN_X + w * HALF_W, ORIGIN_Y + (w - 1) * HALF_H - WALL_H)
        val e = at((w - 1).toFloat(), 0f)
        val s = at((w - 1).toFloat(), (h - 1).toFloat())
        val wv = at(0f, (h - 1).toFloat())
        return listOf(
            r0, r1, r2,
            Offset(e.x + HALF_W, e.y),
            Offset(s.x, s.y + HALF_H),
            Offset(wv.x - HALF_W, wv.y)
        )
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
