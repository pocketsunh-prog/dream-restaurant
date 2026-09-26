package com.dreamrestaurant

import androidx.compose.ui.geometry.Offset
import com.dreamrestaurant.ui.GameRunner
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 視圖縮放／平移（純 UI）的數學檢定 */
class ViewTransformTest {

    private fun newRunner(): GameRunner =
        GameRunner(seed = 20240101L).also {
            it.canvasW = 1200f
            it.canvasH = 700f
        }

    /** 店內邏輯點 [lp] 目前落在畫布的哪個像素 */
    private fun screenOf(runner: GameRunner, lp: Offset): Offset {
        val fit = runner.fitTransform() ?: error("畫布尺寸未就緒")
        val tr = fit.second
        val s = fit.first * runner.zoom
        return Offset(tr.x + runner.panX + lp.x * s, tr.y + runner.panY + lp.y * s)
    }

    @Test
    fun fitDefaultsToNoZoom() {
        val runner = newRunner()
        assertEquals(1f, runner.zoom, 0f)
        assertEquals(0f, runner.panX, 0f)
        assertEquals(0f, runner.panY, 0f)
        assertTrue(runner.fitTransform() != null)
        assertTrue(runner.fitTransform()!!.first > 0f)
    }

    @Test
    fun pinchAnchorsTheFocalPoint() {
        val runner = newRunner()
        val fit = runner.fitTransform()!!
        val base = fit.first
        val tr = fit.second
        val rc = runner.roomCenter()

        // 選一個畫布中心附近的錨點，推算它對應的邏輯座標
        val anchor = Offset(600f, 350f)
        val lp = Offset(
            (anchor.x - (tr.x + runner.panX)) / (base * runner.zoom),
            (anchor.y - (tr.y + runner.panY)) / (base * runner.zoom)
        )

        val before = screenOf(runner, lp)
        runner.applyGesture(base, tr, 1.5f, anchor, Offset.Zero, rc)
        val after = screenOf(runner, lp)

        assertEquals(before.x, after.x, 0.5f)
        assertEquals(before.y, after.y, 0.5f)
        assertEquals(1.5f, runner.zoom, 1e-4f)
        assertEquals(rc, runner.roomCenter())
    }

    @Test
    fun zoomIsClampedBetweenLimits() {
        val runner = newRunner()
        val fit = runner.fitTransform()!!
        val rc = runner.roomCenter()
        val c = Offset(runner.canvasW / 2f, runner.canvasH / 2f)

        runner.applyGesture(fit.first, fit.second, 1000f, c, Offset.Zero, rc)
        assertEquals(5f, runner.zoom, 1e-4f)

        runner.applyGesture(fit.first, fit.second, 0.0001f, c, Offset.Zero, rc)
        assertEquals(0.5f, runner.zoom, 1e-4f)
    }

    @Test
    fun roomCenterStaysOnScreen() {
        val runner = newRunner()
        val fit = runner.fitTransform()!!
        val rc = runner.roomCenter()

        // 塞一個超大拖曳，看鉗制有沒有把店拉出畫布
        runner.applyGesture(
            fit.first, fit.second, 1f,
            Offset(0f, 0f), Offset(-90000f, -90000f), rc
        )
        val s = screenOf(runner, rc)
        assertTrue("店中心跑出畫布了", s.x >= -1f && s.x <= runner.canvasW + 1f)
        assertTrue("店中心跑出畫布了", s.y >= -1f && s.y <= runner.canvasH + 1f)

        runner.applyGesture(
            fit.first, fit.second, 1f,
            Offset(0f, 0f), Offset(90000f, 90000f), rc
        )
        val s2 = screenOf(runner, rc)
        assertTrue(s2.x >= -1f && s2.x <= runner.canvasW + 1f)
        assertTrue(s2.y >= -1f && s2.y <= runner.canvasH + 1f)
    }

    @Test
    fun resetViewRestoresFit() {
        val runner = newRunner()
        val fit = runner.fitTransform()!!
        val rc = runner.roomCenter()
        runner.applyGesture(fit.first, fit.second, 2.2f, Offset(100f, 100f), Offset(40f, -25f), rc)
        runner.resetView()
        assertEquals(1f, runner.zoom, 0f)
        assertEquals(0f, runner.panX, 0f)
        assertEquals(0f, runner.panY, 0f)
    }
}
