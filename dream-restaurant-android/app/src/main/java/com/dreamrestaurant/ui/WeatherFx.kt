package com.dreamrestaurant.ui

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.ClipOp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipPath

/**
 * 螢幕空間的氣象與光線前景（在等角 transform 之外套用）：
 * 時段色調、雲雨雪、閃電、暗角。
 *
 * [room] 是房間剪影（螢幕座標）：降水只畫在店外，店內不糊掉 —
 * 對應 Web 版 `drawWeather(..., { excludePoly: roomSilhouette(...) })`。
 */
fun DrawScope.drawAtmosphere(minute: Int, weather: String, frame: Long, room: Path?) {
    drawTimeTint(minute, weather)
    if (room != null) {
        clipPath(room, ClipOp.Difference) {
            drawPrecipitation(weather, frame, size.width, size.height)
        }
    } else {
        drawPrecipitation(weather, frame, size.width, size.height)
    }
    drawVignette()
}

/* ---------------------------------------------------------------- 時段色調 */

private fun DrawScope.drawTimeTint(minute: Int, weather: String) {
    val m = ((minute % 1440) + 1440) % 1440
    val tod: Color
    val todA: Float
    when {
        m in 5 * 60 until 7 * 60 -> { // 黎明
            tod = Color(0xFF5a4478)
            todA = 0.16f
        }
        m in 16 * 60 + 30 until 19 * 60 -> { // 黃昏
            tod = Color(0xFF7a4326)
            todA = 0.17f
        }
        m >= 19 * 60 || m < 5 * 60 -> { // 夜晚
            tod = Color(0xFF131f4a)
            todA = 0.34f
        }
        else -> {
            tod = Color.Transparent
            todA = 0f
        }
    }
    if (todA > 0f) drawRect(tod.copy(alpha = todA))

    val (wx, wa) = when (weather) {
        "cloudy" -> Color(0xFF3c4457) to 0.11f
        "rain" -> Color(0xFF273457) to 0.17f
        "storm" -> Color(0xFF151d38) to 0.26f
        "cold" -> Color(0xFFbcd8ff) to 0.09f
        "heat" -> Color(0xFFff9d4f) to 0.11f
        else -> Color.Transparent to 0f
    }
    if (wa > 0f) drawRect(wx.copy(alpha = wa))
}

/* ------------------------------------------------------------------ 降水 */

private fun DrawScope.drawPrecipitation(weather: String, frame: Long, w: Float, h: Float) {
    if (weather == "rain" || weather == "storm") {
        val storm = weather == "storm"
        val n = if (storm) 150 else 80
        val t = (frame / 20.0).toFloat()
        val alpha = if (storm) 0.55f else 0.34f
        val slant = if (storm) 13f else 7f
        for (i in 0 until n) {
            val r1 = hashFloat(i, 1)
            val r2 = hashFloat(i, 2)
            val speed = (if (storm) 1500f else 1050f) + r1 * 520f
            val len = 16f + r2 * 16f
            val span = h + len + 40f
            val y = (r2 * span + t * speed).mod(span) - len
            val x = (r1 * w + t * 120f).mod(w)
            drawLine(
                Color(0xFFcfe4ff).copy(alpha = alpha),
                Offset(x, y),
                Offset(x - slant, y + len),
                strokeWidth = if (storm) 2.1f else 1.5f
            )
        }
        // 閃電：每 12 秒一次短促白光
        if (storm) {
            val slot = frame % 240L
            if (slot < 7L) {
                val a = if (slot < 3L) 0.30f else 0.14f
                drawRect(Color(0xFFeaf2ff).copy(alpha = a))
            }
        }
    } else if (weather == "cold") {
        val n = 90
        val t = (frame / 20.0).toFloat()
        for (i in 0 until n) {
            val r1 = hashFloat(i, 3)
            val r2 = hashFloat(i, 4)
            val speed = 70f + r1 * 60f
            val span = h + 40f
            val y = (r2 * span + t * speed).mod(span) - 20f
            val drift = kotlin.math.sin(t * 0.7 + i) * 16.0
            val x = (r1 * w + t * 26f + drift.toFloat()).mod(w)
            val r = 1.2f + r2 * 1.6f
            drawCircle(Color(0xFFeef6ff).copy(alpha = 0.75f), radius = r, center = Offset(x, y))
        }
    }
}

/* ------------------------------------------------------------------ 暗角 */

private fun DrawScope.drawVignette() {
    val w = size.width
    val h = size.height
    val brush = Brush.radialGradient(
        0.0f to Color.Transparent,
        0.55f to Color.Transparent,
        1.0f to Color(0xFF000000).copy(alpha = 0.42f),
        center = Offset(w / 2f, h / 2f),
        radius = maxOf(w, h) * 0.72f
    )
    drawRect(brush, size = Size(w, h))
}

/* ------------------------------------------------------------------ 小工具 */

private fun hashInt(n: Int): Int {
    var h = n
    h = h xor (h ushr 16)
    h *= 0x7feb352d
    h = h xor (h ushr 15)
    h *= 0x846ca68b.toInt()
    h = h xor (h ushr 16)
    return h
}

private fun hashFloat(i: Int, salt: Int): Float {
    val h = hashInt(i * 374761393 + salt * 668265263)
    return ((h ushr 8) and 0xffffff).toFloat() / 16777216f
}
