package com.dreamrestaurant.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dreamrestaurant.core.B
import com.dreamrestaurant.core.GameAction
import com.dreamrestaurant.core.GameState
import com.dreamrestaurant.core.UiMsg
import com.dreamrestaurant.core.round
import com.dreamrestaurant.data.furnitureById
import com.dreamrestaurant.sim.Layout
import com.dreamrestaurant.sim.seatCount
import com.dreamrestaurant.ui.audio.GameAudio
import kotlinx.coroutines.delay
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

private const val KIND_WALL = 0
private const val KIND_ITEM = 1
private const val KIND_CUSTOMER = 2
private const val KIND_STAFF = 3
private const val KIND_WALKER = 4

private class RObj(val depth: Float, val kind: Int, val idx: Int)

/* ------------------------------------------------------------------ 畫面 */

@Composable
fun GameScreen(runner: GameRunner) {
    val frame = runner.frame
    val state = runner.state()

    // 模擬主迴圈：每 50ms 一個 tick，dt 用實際經過的秒數
    LaunchedEffect(runner) {
        var last = System.nanoTime()
        while (true) {
            delay(50)
            val now = System.nanoTime()
            val dt = ((now - last) / 1_000_000_000.0).coerceIn(0.0, 0.25)
            last = now
            runner.tick(dt)
        }
    }

    val uiMsg = state.uiQueue.firstOrNull()
    LaunchedEffect(uiMsg, runner) {
        if (uiMsg != null) {
            // 對齊 main.js 的 processUiQueue() 音效分支
            when (uiMsg.type) {
                "dayEnd", "settle" -> GameAudio.sfx("settle")
                "starUp", "annualAward" -> GameAudio.sfx("star")
                "gameover" -> GameAudio.sfx("alarm")
                "event" -> GameAudio.sfx(if (uiMsg.kind == "negative") "alarm" else "coin")
                else -> when (uiMsg.kind) {
                    "bad" -> GameAudio.sfx("error")
                    "good" -> GameAudio.sfx("coin")
                    else -> GameAudio.sfx("click")
                }
            }
            if (uiMsg.type == "toast" && uiMsg.message.isNotEmpty()) {
                delay(3000)
                runner.dispatch(GameAction.DismissUi)
            }
        }
    }

    // 音訊：AudioTrack 在第一次互動（首次 sfx）時才建立，跟 Web 版等使用者手勢才開聲一樣
    LaunchedEffect(runner) {
        var lastMusic: String? = null
        var lastSound: Boolean? = null
        while (true) {
            delay(250)
            val s = runner.state()
            if (s.settings.music != lastMusic) {
                lastMusic = s.settings.music
                GameAudio.setMusic(s.settings.music)
            }
            if (runner.soundOn != lastSound) {
                lastSound = runner.soundOn
                GameAudio.setEnabled(runner.soundOn)
            }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Color(0xFF0e1426))
    ) {
        HudBar(runner, state)
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .clipToBounds()
        ) {
            RoomCanvas(runner, state, Modifier.fillMaxSize())
            if (uiMsg != null) {
                NoticeBanner(uiMsg, runner, Modifier.align(Alignment.Center))
            }
            val logLine = state.log.lastOrNull()
            if (logLine != null) {
                Text(
                    logLine.text,
                    color = Color(0xFF9fb0d0),
                    fontSize = 11.sp,
                    maxLines = 1,
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                )
            }
            runner.lastError?.let { err ->
                Row(
                    Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(err, color = Color(0xFFFF8A80), fontSize = 11.sp, maxLines = 2)
                    TextButton(onClick = { runner.clearError() }) { Text("關閉", fontSize = 11.sp) }
                }
            }
        }
        ControlBar(runner, state)
    }
}

@Composable
@Suppress("UNUSED_PARAMETER")
private fun HudBar(runner: GameRunner, state: GameState) {
    // GameState 欄位不是 snapshot state：必須在這裡讀 frame，HUD 才會每 tick 重繪
    @Suppress("UNUSED_VARIABLE")
    val frame = runner.frame
    val today = state.stats.today
    val phaseText = when (state.phase) {
        "build" -> "準備中"
        "open" -> "營業中"
        "closing" -> "打烊中"
        "closed" -> "已打烊"
        "settle" -> "結算中"
        "gameover" -> "破產"
        else -> state.phase
    }
    val phaseColor = when (state.phase) {
        "open" -> Color(0xFF66BB6A)
        "closing" -> Color(0xFFFFB74D)
        "closed" -> Color(0xFF90A4AE)
        "gameover" -> Color(0xFFEF5350)
        else -> Color(0xFF64B5F6)
    }
    val queue = state.sim.customers.count { it.state == "queueing" }

    Row(
        Modifier
            .fillMaxWidth()
            .background(Color(0xFF151c36))
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Stat(label = "天", value = "${state.day}")
        Stat(label = "時間", value = String.format(Locale.US, "%02d:%02d", state.minute / 60, state.minute % 60))
        Text(
            phaseText,
            color = Color.White,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .background(phaseColor.copy(alpha = 0.25f))
                .padding(horizontal = 8.dp, vertical = 3.dp)
        )
        Stat(label = "天氣", value = B.WEATHER_NAME[state.sim.weather] ?: state.sim.weather)
        Stat(label = "現金", value = String.format(Locale.US, "NT$ %,d", state.cash.toLong()))
        Stat(label = "社區", value = "${round(state.reputation.community).toInt()}")
        Stat(label = "區外", value = "${round(state.reputation.outside).toInt()}")
        Stat(label = "星級", value = "${state.stars}")
        Stat(label = "來客", value = "${today.guests}")
        Stat(label = "服務", value = "${today.served}")
        Stat(label = "生氣", value = "${today.angry}")
        Stat(label = "座位", value = "${seatCount(state.sim.tables)}")
        Stat(label = "候位", value = "$queue")
        Stat(label = "員工", value = "${state.staff.size}")
    }
}

@Composable
private fun Stat(label: String, value: String) {
    Row(verticalAlignment = Alignment.Bottom) {
        Text(label, color = Color(0xFF8494b8), fontSize = 11.sp)
        Spacer(Modifier.width(4.dp))
        Text(value, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
@Suppress("UNUSED_PARAMETER")
private fun ControlBar(runner: GameRunner, state: GameState) {
    // 同 HudBar：讀 frame 觸發重繪（速度鈕的選取狀態）
    @Suppress("UNUSED_VARIABLE")
    val frame = runner.frame
    Row(
        Modifier
            .fillMaxWidth()
            .background(Color(0xFF151c36))
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        when (state.phase) {
            "build" -> Button(onClick = { runner.dispatch(GameAction.StartDay) }) {
                Text("▶ 開始營業", fontSize = 13.sp)
            }
            "open" -> OutlinedButton(onClick = { runner.dispatch(GameAction.EndDay) }) {
                Text("提前打烊", fontSize = 13.sp)
            }
            "closed" -> Button(onClick = { runner.dispatch(GameAction.NextDay) }) {
                Text("⏭ 隔日", fontSize = 13.sp)
            }
            else -> {}
        }

        Label("速度")
        for (sp in B.SPEEDS) {
            val text = if (sp == 0) "暫停" else "${sp}x"
            Chip(text, selected = state.speed == sp) {
                runner.dispatch(GameAction.SetSpeed(sp))
            }
        }

        Label("快轉")
        for (mul in listOf(1, 5, 20)) {
            Chip("×$mul", selected = runner.demoMul == mul) { runner.setFastForward(mul) }
        }

        Label("音效")
        Chip(if (runner.soundOn) "開" else "關", selected = runner.soundOn) { runner.toggleSound() }

        Label("曲風")
        val musicOrder = listOf("lazy", "tropical", "classic1", "classic2", "pop", "off")
        Chip(musicLabel(state.settings.music), selected = state.settings.music != "off") {
            val cur = musicOrder.indexOf(state.settings.music)
            runner.dispatch(GameAction.SetMusic(musicOrder[(cur + 1) % musicOrder.size]))
        }
    }
}

private fun musicLabel(id: String): String = when (id) {
    "off" -> "靜音"
    "lazy" -> "悠閒"
    "tropical" -> "熱帶"
    "classic1" -> "古典一"
    "classic2" -> "古典二"
    "pop" -> "流行"
    else -> id
}

@Composable
private fun Label(text: String) {
    Text(text, color = Color(0xFF8494b8), fontSize = 11.sp)
}

@Composable
private fun Chip(text: String, selected: Boolean, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 2.dp),
        colors = ButtonDefaults.outlinedButtonColors(
            contentColor = if (selected) Color(0xFF0e1426) else Color(0xFFc8d4ee)
        ),
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            if (selected) Color(0xFF64B5F6) else Color(0xFF3a466b)
        ),
        modifier = if (selected) Modifier.background(Color(0xFF64B5F6)) else Modifier
    ) {
        Text(text, fontSize = 12.sp)
    }
}

@Composable
private fun NoticeBanner(msg: UiMsg, runner: GameRunner, modifier: Modifier = Modifier) {
    val title = describeMsg(msg)
    Row(
        modifier
            .background(Color(0xFF1f2a4d))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(title, color = Color(0xFFe6ecff), fontSize = 13.sp, maxLines = 4)
        Spacer(Modifier.width(8.dp))
        TextButton(onClick = {
            if (msg.type == "settle") runner.dispatch(GameAction.AckSettle)
            runner.dispatch(GameAction.DismissUi)
        }) { Text("知道了", fontSize = 12.sp) }
    }
}

private fun describeMsg(msg: UiMsg): String = when (msg.type) {
    "dayEnd" -> {
        val r = msg.record
        if (r != null) "第 ${msg.day} 天打烊：營業額 NT$ ${String.format(Locale.US, "%,d", r.revenue)}、淨利 NT$ ${String.format(Locale.US, "%,d", r.profit)}、來客 ${r.guests} 人"
        else "第 ${msg.day} 天打烊"
    }
    "settle" -> "第 ${msg.week} 週雜誌結算完成"
    "gameover" -> "現金見底，餐廳倒閉了"
    else -> msg.message.ifEmpty { msg.type }
}

/* ------------------------------------------------------------ 等角繪製 */

@Composable
private fun RoomCanvas(runner: GameRunner, state: GameState, modifier: Modifier = Modifier) {
    // 讀一次 frame：每次 tick 都會重繪
    val frame = runner.frame
    Canvas(modifier) {
        val layout = state.layout
        val box = Iso.contentBox(layout)
        val (scale, tr) = Iso.fit(box, size.width, size.height, 10f)
        drawRect(Color(0xFF0b1020))
        withTransform({
            translate(tr.x, tr.y)
            scale(scale, scale, Offset.Zero)
        }) {
            drawRoom(state, frame)
        }
    }
}

@Suppress("UNUSED_PARAMETER")
private fun DrawScope.drawRoom(state: GameState, frame: Long) {
    val layout = state.layout
    val gw = layout.gridW
    val gh = layout.gridH
    val floorBase = parseHex(state.settings.floorColor, Color(0xFF8c6a44))
    val wallBase = parseHex(state.settings.wallColor, Color(0xFFc9a26b))

    // 外景
    drawRect(Color(0xFF0e1426), topLeft = Offset(-900f, -900f), size = Size(3600f, 2800f))
    drawSidewalk(layout, gw, gh)

    // 地板（由後往前）
    for (sum in 0..(gw + gh - 2)) {
        val x0 = max(0, sum - (gh - 1))
        val x1 = min(gw - 1, sum)
        for (x in x0..x1) {
            val y = sum - x
            val tile = layout.tiles[y * gw + x]
            if (tile == "wall" || tile == "void") continue
            val c = when (tile) {
                "kitchen" -> Color(0xFF454c60)
                "restroom" -> Color(0xFF5f6a7d)
                "pass" -> Color(0xFF7a5a33)
                "door" -> Color(0xFFa5793f)
                else -> if ((x + y) % 2 == 0) floorBase else multiply(floorBase, 0.93f)
            }
            drawFloorTile(x, y, c, tile == "door")
        }
    }

    // 依深度排序的物件（牆 → 傢俱 → 人物）
    val objs = ArrayList<RObj>(gw * 4 + state.layout.items.size + 48)
    for (sum in 0..(gw + gh - 2)) {
        val x0 = max(0, sum - (gh - 1))
        val x1 = min(gw - 1, sum)
        for (x in x0..x1) {
            val y = sum - x
            if (layout.tiles[y * gw + x] == "wall") objs.add(RObj(sum.toFloat(), KIND_WALL, y * gw + x))
        }
    }
    for ((i, item) in state.layout.items.withIndex()) {
        val depth = (item.x + item.w / 2f) + (item.y + item.h / 2f)
        objs.add(RObj(depth, KIND_ITEM, i))
    }
    for ((i, c) in state.sim.customers.withIndex()) objs.add(RObj((c.x + c.y).toFloat(), KIND_CUSTOMER, i))
    for ((i, s) in state.staff.withIndex()) objs.add(RObj((s.x + s.y).toFloat(), KIND_STAFF, i))
    for ((i, w) in state.sim.walkers.withIndex()) objs.add(RObj((w.x + w.y).toFloat(), KIND_WALKER, i))
    objs.sortWith(compareBy({ it.depth }, { it.kind }))

    for (o in objs) {
        when (o.kind) {
            KIND_WALL -> {
                val x = o.idx % gw
                val y = o.idx / gw
                val top = multiply(wallBase, 1.14f)
                drawBox(x, y, 1, 1, Iso.WALL_H, top, multiply(wallBase, 0.84f), multiply(wallBase, 0.66f))
            }
            KIND_ITEM -> {
                val item = state.layout.items[o.idx]
                val def = furnitureById(item.typeId)
                val palette = paletteFor(def?.category)
                val h = heightFor(def?.category)
                val top = if (item.broken) Color(0xFFef5350) else palette.first
                drawBox(item.x, item.y, item.w, item.h, h, top, palette.second, palette.third)
            }
            KIND_CUSTOMER -> drawCustomer(state.sim.customers[o.idx])
            KIND_STAFF -> drawStaff(state.staff[o.idx])
            KIND_WALKER -> drawWalker(state.sim.walkers[o.idx])
        }
    }
}

private fun DrawScope.drawSidewalk(layout: Layout, gw: Int, gh: Int) {
    val lane = layout.sidewalk
    val ly = lane.y.toFloat()
    val x0 = (lane.x0 - 1).toFloat()
    val x1 = (lane.x1 + 1).toFloat()
    val a = Iso.at(x0, ly - 1.0f)
    val b = Iso.at(x1, ly - 1.0f)
    val c = Iso.at(x1, ly + 1.0f)
    val d = Iso.at(x0, ly + 1.0f)
    drawPath(poly(a, b, c, d), Color(0xFF2b3350))
    // 磚面分割
    var x = x0
    while (x <= x1) {
        val p0 = Iso.at(x, ly - 1.0f)
        val p1 = Iso.at(x, ly + 1.0f)
        drawLine(Color(0xFF333c60), p0, p1, strokeWidth = 1.2f)
        x += 1f
    }
}

private fun DrawScope.drawFloorTile(x: Int, y: Int, color: Color, isDoor: Boolean) {
    val c = Iso.at(x.toFloat(), y.toFloat())
    val path = diamond(c)
    drawPath(path, color)
    drawPath(path, Color.White.copy(alpha = 0.06f), style = Stroke(1.1f))
    if (isDoor) {
        val inner = Iso.at(x.toFloat(), y.toFloat() + 0.35f)
        drawPath(diamond(inner, 0.45f), Color(0xFF3d2a14).copy(alpha = 0.75f))
    }
}

private fun DrawScope.drawBox(
    x: Int, y: Int, w: Int, h: Int, height: Float,
    top: Color, left: Color, right: Color
) {
    if (w <= 0 || h <= 0) return
    val a = Iso.at(x - 0.5f, y - 0.5f)
    val b = Iso.at(x + w - 0.5f, y - 0.5f)
    val c = Iso.at(x + w - 0.5f, y + h - 0.5f)
    val d = Iso.at(x - 0.5f, y + h - 0.5f)
    val up = Offset(0f, -height)
    drawPath(poly(c, d, d + up, c + up), left)
    drawPath(poly(b, c, c + up, b + up), right)
    drawPath(poly(a + up, b + up, c + up, d + up), top)
}

private fun DrawScope.drawCustomer(c: com.dreamrestaurant.core.Customer) {
    val p = Iso.at(c.x, c.y)
    val body = moodColor(c.mood)
    val r = 6.5f + c.partySize * 0.7f
    drawCircle(Color(0xFF000000).copy(alpha = 0.35f), radius = r + 2f, center = p + Offset(0f, 3f))
    drawCircle(body, radius = r, center = p - Offset(0f, 9f))
    drawCircle(Color.White.copy(alpha = 0.8f), radius = r, center = p - Offset(0f, 9f), style = Stroke(1.3f))
    if (c.bubble != null) {
        drawCircle(
            Color(0xFFFFC107),
            radius = r + 3.5f,
            center = p - Offset(0f, 9f),
            style = Stroke(1.4f)
        )
    }
}

private fun DrawScope.drawStaff(s: com.dreamrestaurant.core.HiredStaff) {
    val p = Iso.at(s.x, s.y)
    val body = if (s.role == "chef") Color(0xFFFF9800) else Color(0xFF26C6DA)
    drawCircle(Color(0xFF000000).copy(alpha = 0.35f), radius = 9f, center = p + Offset(0f, 3f))
    drawCircle(body, radius = 7.5f, center = p - Offset(0f, 10f))
    drawCircle(Color(0xFF0e1426).copy(alpha = 0.9f), radius = 7.5f, center = p - Offset(0f, 10f), style = Stroke(1.4f))
    if (s.state == "off") {
        drawLine(Color(0xFF90A4AE), p - Offset(6f, 16f), p - Offset(-6f, 4f), strokeWidth = 2f)
    }
}

private fun DrawScope.drawWalker(w: com.dreamrestaurant.core.Walker) {
    val p = Iso.at(w.x, w.y)
    drawCircle(Color(0xFF9E9E9E), radius = 5.5f, center = p - Offset(0f, 7f))
    drawCircle(Color(0xFF0e1426).copy(alpha = 0.8f), radius = 5.5f, center = p - Offset(0f, 7f), style = Stroke(1.2f))
}

/* ------------------------------------------------------------------ 小工具 */

private fun diamond(center: Offset, shrink: Float = 1f): Path = Path().apply {
    moveTo(center.x, center.y - Iso.HALF_H * shrink)
    lineTo(center.x + Iso.HALF_W * shrink, center.y)
    lineTo(center.x, center.y + Iso.HALF_H * shrink)
    lineTo(center.x - Iso.HALF_W * shrink, center.y)
    close()
}

private fun poly(p0: Offset, p1: Offset, p2: Offset, p3: Offset): Path = Path().apply {
    moveTo(p0.x, p0.y)
    lineTo(p1.x, p1.y)
    lineTo(p2.x, p2.y)
    lineTo(p3.x, p3.y)
    close()
}

private fun parseHex(hex: String, fallback: Color): Color = try {
    Color(android.graphics.Color.parseColor(hex))
} catch (_: Throwable) {
    fallback
}

private fun multiply(c: Color, f: Float): Color =
    Color(
        (c.red * f).coerceIn(0f, 1f),
        (c.green * f).coerceIn(0f, 1f),
        (c.blue * f).coerceIn(0f, 1f),
        c.alpha
    )

private fun moodColor(mood: Double): Color = when {
    mood >= 40 -> Color(0xFF66BB6A)
    mood >= 10 -> Color(0xFFDCE775)
    mood >= -10 -> Color(0xFFFFB74D)
    else -> Color(0xFFEF5350)
}

private fun paletteFor(category: String?): Triple<Color, Color, Color> = when (category) {
    "table" -> Triple(Color(0xFFa9743f), Color(0xFF8a5c31), Color(0xFF6b4626))
    "chair" -> Triple(Color(0xFF8a5a33), Color(0xFF6f4727), Color(0xFF55351d))
    "kitchen", "equipment" -> Triple(Color(0xFF8b95a5), Color(0xFF6e7787), Color(0xFF555d6b))
    "restroom" -> Triple(Color(0xFFcfd6e0), Color(0xFFaeb6c4), Color(0xFF8f97a5))
    "decor" -> Triple(Color(0xFFc98a4b), Color(0xFFa56e39), Color(0xFF82552c))
    "lighting" -> Triple(Color(0xFFd9c47e), Color(0xFFb6a366), Color(0xFF8f8050))
    else -> Triple(Color(0xFF7d8797), Color(0xFF646d7c), Color(0xFF4d5563))
}

private fun heightFor(category: String?): Float = when (category) {
    "table" -> 15f
    "chair" -> 11f
    "kitchen", "equipment" -> 34f
    "restroom" -> 24f
    "decor" -> 20f
    "lighting" -> 26f
    else -> 14f
}
