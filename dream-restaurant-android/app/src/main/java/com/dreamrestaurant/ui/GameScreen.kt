package com.dreamrestaurant.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dreamrestaurant.core.B
import com.dreamrestaurant.core.GameAction
import com.dreamrestaurant.core.GameState
import com.dreamrestaurant.core.UiMsg
import com.dreamrestaurant.core.round
import com.dreamrestaurant.data.furnitureById
import com.dreamrestaurant.data.getDish
import com.dreamrestaurant.sim.Layout
import com.dreamrestaurant.sim.seatCount
import com.dreamrestaurant.sim.tileAt
import com.dreamrestaurant.ui.audio.GameAudio
import com.dreamrestaurant.ui.panels.PanelBar
import com.dreamrestaurant.ui.panels.PanelOverlay
import kotlinx.coroutines.delay
import java.util.Locale
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val KIND_WALL = 0
private const val KIND_ITEM = 1
private const val KIND_CUSTOMER = 2
private const val KIND_STAFF = 3
private const val KIND_WALKER = 4

private class RObj(val depth: Float, val kind: Int, val idx: Int, val chair: Boolean = false)

/**
 * 物件排序：先依深度，同深度時椅子要排在同位置的顧客前面（人疊在椅子上）。
 */
private fun objCompare(a: RObj, b: RObj): Int {
    if (a.depth != b.depth) return if (a.depth < b.depth) -1 else 1
    val ka = if (a.chair) KIND_WALKER + 1 else a.kind
    val kb = if (b.chair) KIND_WALKER + 1 else b.kind
    if (ka != kb) return ka - kb
    return a.idx - b.idx
}

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

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0xFF0e1426))
    ) {
        Column(Modifier.fillMaxSize()) {
            HudBar(runner, state)
            PanelBar(runner)
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
                        .align(Alignment.BottomEnd)
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(err, color = Color(0xFFFF8A80), fontSize = 11.sp, maxLines = 2)
                    TextButton(onClick = { runner.clearError() }) { Text("關閉", fontSize = 11.sp) }
                }
            }
            ZoomControls(runner)
            SaveControls(runner)
        }
            ControlBar(runner, state)
        }
        if (runner.openPanel != null) {
            PanelOverlay(runner)
        }
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

        Label("語音")
        Chip(if (runner.voiceOn) "日" else "關", selected = runner.voiceOn) { runner.toggleVoice() }

        Label("曲風")
        val musicOrder = listOf("lazy", "tropical", "classic1", "classic2", "pop", "off")
        Chip(musicLabel(state.settings.music), selected = state.settings.music != "off") {
            val cur = musicOrder.indexOf(state.settings.music)
            runner.dispatch(GameAction.SetMusic(musicOrder[(cur + 1) % musicOrder.size]))
        }
    }
}

/** 畫布上的縮放控制（捏合／雙擊也能操作） */
@Composable
private fun BoxScope.ZoomControls(runner: GameRunner) {
    Column(
        Modifier
            .align(Alignment.TopEnd)
            .padding(8.dp)
            .background(Color(0xB0101728), RoundedCornerShape(12.dp))
            .padding(horizontal = 6.dp, vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Chip("＋", selected = false) { runner.zoomByButton(1.25f) }
        Text("${Math.round(runner.zoom * 100)}%", color = Color(0xFFc8d4ee), fontSize = 12.sp)
        Chip("－", selected = false) { runner.zoomByButton(1f / 1.25f) }
        Chip("適合", selected = false) { runner.resetView() }
    }
}

/** 畫布上的快速存讀檔 */
@Composable
private fun BoxScope.SaveControls(runner: GameRunner) {
    Row(
        Modifier
            .align(Alignment.TopStart)
            .padding(8.dp)
            .background(Color(0xB0101728), RoundedCornerShape(12.dp))
            .padding(horizontal = 6.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Chip("存檔", selected = false) { runner.dispatch(GameAction.SaveGame("auto")) }
        Chip("讀檔", selected = false) { runner.dispatch(GameAction.LoadGame("auto")) }
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
    val zoom = runner.zoom
    val panX = runner.panX
    val panY = runner.panY
    val textMeasurer = rememberTextMeasurer()

    Canvas(
        modifier
            .onSizeChanged {
                runner.canvasW = it.width.toFloat()
                runner.canvasH = it.height.toFloat()
            }
            // 雙擊＝回適合畫面
            .pointerInput(runner) {
                detectTapGestures(onDoubleTap = { runner.resetView() })
            }
            // 捏合縮放＋拖曳平移
            .pointerInput(runner) {
                detectTransformGestures { centroid, panDelta, zoomDelta, _ ->
                    val fitted = runner.fitTransform() ?: return@detectTransformGestures
                    runner.applyGesture(
                        fitted.first, fitted.second, zoomDelta,
                        centroid, panDelta, runner.roomCenter()
                    )
                }
            }
    ) {
        val layout = state.layout
        val box = Iso.contentBox(layout)
        val fitted = Iso.fit(box, size.width, size.height, 10f)
        val scale = fitted.first * zoom
        val tx = fitted.second.x + panX
        val ty = fitted.second.y + panY
        drawRect(Color(0xFF0b1020))
        withTransform({
            translate(tx, ty)
            scale(scale, scale, Offset.Zero)
        }) {
            drawRoom(state, frame, textMeasurer)
        }
        // 房間剪影（螢幕座標）：降水要繞開室內，才不會在店裡下雨
        val sil = Iso.roomSilhouette(layout.gridW, layout.gridH)
        val roomPath = Path().apply {
            moveTo(sil[0].x * scale + tx, sil[0].y * scale + ty)
            for (i in 1 until sil.size) {
                lineTo(sil[i].x * scale + tx, sil[i].y * scale + ty)
            }
            close()
        }
        drawAtmosphere(state.minute, state.sim.weather, frame, roomPath)
    }
}

@Suppress("UNUSED_PARAMETER")
private fun DrawScope.drawRoom(state: GameState, frame: Long, tm: TextMeasurer) {
    val layout = state.layout
    val gw = layout.gridW
    val gh = layout.gridH
    val wallBase = parseHex(state.settings.wallColor, Color(0xFFc9a26b))

    // 外景
    drawRect(Color(0xFF0e1426), topLeft = Offset(-900f, -900f), size = Size(3600f, 2800f))

    // 地面（人行道＋地磚）離屏烘焙，改色／改格局才重畫
    val ground = ensureGround(state)
    drawImage(
        ground.image,
        dstOffset = IntOffset(Math.round(ground.ox), Math.round(ground.oy))
    )

    // 雨天積水
    if (state.sim.weather == "rain" || state.sim.weather == "storm") {
        drawPuddles(layout, frame)
    }

    // 依深度排序的物件（牆 → 傢俱 → 人物）
    val objs = ArrayList<RObj>(gw * 4 + layout.items.size + 48)
    for (sum in 0..(gw + gh - 2)) {
        val x0 = max(0, sum - (gh - 1))
        val x1 = min(gw - 1, sum)
        for (x in x0..x1) {
            val y = sum - x
            if (layout.tiles[y * gw + x] == "wall") objs.add(RObj(sum.toFloat(), KIND_WALL, y * gw + x))
        }
    }
    // 已經有客人坐著的座位（依座標比對）：椅子要張貼在桌子邊、不可再外拉，
    // 否則人會看起來坐在椅子旁邊。同時用來決定座位是否畫成「被坐凹」。
    val occupiedSeats = occupiedSeatPositions(state)
    for ((i, item) in layout.items.withIndex()) {
        val depth = (item.x + item.w / 2f) + (item.y + item.h / 2f)
        objs.add(RObj(depth, KIND_ITEM, i, chair = isChairItem(item)))
    }
    for ((i, c) in state.sim.customers.withIndex()) objs.add(RObj((c.x + c.y).toFloat(), KIND_CUSTOMER, i))
    for ((i, s) in state.staff.withIndex()) objs.add(RObj((s.x + s.y).toFloat(), KIND_STAFF, i))
    for ((i, w) in state.sim.walkers.withIndex()) objs.add(RObj((w.x + w.y).toFloat(), KIND_WALKER, i))
    objs.sortWith { a, b -> objCompare(a, b) }

    // 接地陰影先畫一輪，才不會蓋到別的物件
    for (o in objs) when (o.kind) {
        KIND_ITEM -> {
            val item = layout.items[o.idx]
            val cx = Iso.at(item.x - 0.5f + item.w / 2f, item.y - 0.5f + item.h / 2f)
            // 椅子半張在桌下，整體外框的陰影會蓋到桌腳：改用椅腳自己的小橢圓
            val rx = if (o.chair) 11f else (item.w + item.h) * Iso.HALF_W * 0.40f + 3f
            val ry = if (o.chair) 4.6f else rx * 0.42f
            contactShadow(cx, rx, ry, 0.30f)
        }
        KIND_CUSTOMER -> {
            val c = state.sim.customers[o.idx]
            // 坐著的人由椅子自己畫接地陰影，這裡只畫站著／走動的
            if (!isSeatedState(c.state)) contactShadow(Iso.at(c.x, c.y), 8f + c.partySize * 0.8f, 4f, 0.34f)
        }
        KIND_STAFF -> {
            val s = state.staff[o.idx]
            contactShadow(Iso.at(s.x, s.y), 9f, 4.2f, 0.34f)
        }
        KIND_WALKER -> {
            val w = state.sim.walkers[o.idx]
            contactShadow(Iso.at(w.x, w.y), 7f, 3.2f, 0.30f)
        }
    }

    for (o in objs) {
        when (o.kind) {
            KIND_WALL -> {
                val x = o.idx % gw
                val y = o.idx / gw
                drawWallPiece(layout, x, y, wallBase, gw, gh)
            }
            KIND_ITEM -> {
                val item = layout.items[o.idx]
                val def = furnitureById(item.typeId)
                if (isChairItem(item)) {
                    drawChair(item, occupied = occupiedSeats.contains(seatKey(item.x, item.y)))
                } else {
                    val palette = paletteFor(def?.category)
                    val h = heightFor(def?.category)
                    val top = if (item.broken) Color(0xFFef5350) else palette.first
                    drawBox(item.x, item.y, item.w, item.h, h, top, palette.second, palette.third)
                }
            }
            KIND_CUSTOMER -> drawCustomer(state.sim.customers[o.idx], o.idx, frame, tm)
            KIND_STAFF -> drawStaff(state.staff[o.idx], o.idx, frame)
            KIND_WALKER -> drawWalker(state.sim.walkers[o.idx])
        }
    }
}

/* --------------------------------------------------- 地面：離屏烘焙一張 */

private class GroundBake(val key: String, val image: ImageBitmap, val ox: Float, val oy: Float)

private var groundCache: GroundBake? = null

private fun groundKey(state: GameState): String {
    val l = state.layout
    return "${l.gridW}x${l.gridH}|${state.settings.floorColor}|${l.tiles.joinToString("")}"
}

private fun ensureGround(state: GameState): GroundBake {
    val key = groundKey(state)
    val cached = groundCache
    if (cached != null && cached.key == key) return cached
    val made = bakeGround(state)
    groundCache = made
    return made
}

private fun bakeGround(state: GameState): GroundBake {
    val l = state.layout
    val gw = l.gridW
    val gh = l.gridH
    var minX = Float.MAX_VALUE
    var maxX = -Float.MAX_VALUE
    var minY = Float.MAX_VALUE
    var maxY = -Float.MAX_VALUE
    fun acc(x: Float, y: Float) {
        val p = Iso.at(x, y)
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
    }
    for (y in 0 until gh) {
        for (x in 0 until gw) {
            if (l.tiles.getOrNull(y * gw + x) == "void") continue
            acc(x - 0.5f, y - 0.5f)
            acc(x + 0.5f, y - 0.5f)
            acc(x + 0.5f, y + 0.5f)
            acc(x - 0.5f, y + 0.5f)
        }
    }
    val lane = l.sidewalk
    val laneY = lane.y.toFloat()
    acc(lane.x0 - 1f, laneY - 1f)
    acc(lane.x1 + 1f, laneY - 1f)
    acc(lane.x1 + 1f, laneY + 1f)
    acc(lane.x0 - 1f, laneY + 1f)
    if (minX > maxX) {
        minX = 0f
        maxX = 1f
        minY = 0f
        maxY = 1f
    }

    val ox = minX - 6f
    val oy = minY - 6f
    val w = (maxX - minX).toInt() + 13
    val h = (maxY - minY).toInt() + 13
    val bmp = android.graphics.Bitmap.createBitmap(
        w.coerceAtLeast(1), h.coerceAtLeast(1), android.graphics.Bitmap.Config.ARGB_8888
    )
    val cv = android.graphics.Canvas(bmp)
    cv.translate(-ox, -oy)

    paintSidewalk(cv, lane)
    for (sum in 0..(gw + gh - 2)) {
        val x0 = max(0, sum - (gh - 1))
        val x1 = min(gw - 1, sum)
        for (x in x0..x1) {
            val y = sum - x
            val tile = l.tiles.getOrNull(y * gw + x) ?: continue
            if (tile == "wall" || tile == "void") continue
            paintFloorTile(cv, x, y, tile, state.settings.floorColor)
        }
    }
    return GroundBake(groundKey(state), bmp.asImageBitmap(), ox, oy)
}

private fun paintSidewalk(cv: android.graphics.Canvas, lane: com.dreamrestaurant.sim.Sidewalk) {
    val ly = lane.y.toFloat()
    val x0 = (lane.x0 - 1).toFloat()
    val x1 = (lane.x1 + 1).toFloat()
    val a = Iso.at(x0, ly - 1f)
    val b = Iso.at(x1, ly - 1f)
    val c = Iso.at(x1, ly + 1f)
    val d = Iso.at(x0, ly + 1f)
    cv.drawPath(nativePoly(a, b, c, d), nativeFill(0xFF2b3350.toInt()))

    // 柏油顆粒
    val speck = nativeFill(0xFF000000.toInt())
    speck.alpha = 26
    val lite = nativeFill(0xFF8fa0c8.toInt())
    lite.alpha = 24
    for (i in 0 until 420) {
        val u = texHashF(i, 5)
        val v = texHashF(i, 6)
        val p = Iso.at(x0 + u * (x1 - x0), (ly - 1f) + v * 2f)
        cv.drawCircle(p.x, p.y, 0.7f + v * 1.6f, if (u < 0.5f) speck else lite)
    }

    // 路緣石：前後兩條描邊＋一道亮邊
    val curbDark = nativeStroke(0xFF1a2036.toInt(), 2.4f)
    val curbLite = nativeStroke(0xFF454f78.toInt(), 1.6f)
    cv.drawLine(a.x, a.y, b.x, b.y, curbDark)
    cv.drawLine(d.x, d.y, c.x, c.y, curbDark)
    cv.drawLine(d.x, d.y + 1.5f, c.x, c.y + 1.5f, curbLite)
    // 人行道磚縫
    val seam = nativeStroke(0xFF161d33.toInt(), 1.1f)
    seam.alpha = 120
    var x = x0
    while (x <= x1) {
        val p0 = Iso.at(x, ly - 1f)
        val p1 = Iso.at(x, ly + 1f)
        cv.drawLine(p0.x, p0.y, p1.x, p1.y, seam)
        x += 1f
    }
}

private fun paintFloorTile(
    cv: android.graphics.Canvas, x: Int, y: Int, tile: String, floorColor: String
) {
    val floorBase = parseHex(floorColor, Color(0xFF8c6a44))
    val color = when (tile) {
        "kitchen" -> Color(0xFF454c60)
        "restroom" -> Color(0xFF5f6a7d)
        "pass" -> Color(0xFF7a5a33)
        "door" -> Color(0xFFa5793f)
        else -> if ((x + y) % 2 == 0) floorBase else multiply(floorBase, 0.93f)
    }
    val c = Iso.at(x.toFloat(), y.toFloat())
    val t = Offset(c.x, c.y - Iso.HALF_H)
    val r = Offset(c.x + Iso.HALF_W, c.y)
    val b = Offset(c.x, c.y + Iso.HALF_H)
    val l = Offset(c.x - Iso.HALF_W, c.y)

    cv.drawPath(nativePoly(t, r, b, l), nativeFill(color.toArgb()))

    // 陰溝縫（整圈）＋ 立體倒角：上方兩邊打亮、下方兩邊壓暗
    val grout = nativeStroke(0xFF000000.toInt(), 1.2f)
    grout.alpha = 70
    cv.drawPath(nativePoly(t, r, b, l), grout)
    val hi = nativeStroke(multiply(color, 1.12f).toArgb(), 1.3f)
    val lo = nativeStroke(multiply(color, 0.84f).toArgb(), 1.3f)
    cv.drawLine(t.x, t.y, r.x, r.y, hi)
    cv.drawLine(t.x, t.y, l.x, l.y, hi)
    cv.drawLine(l.x, l.y, b.x, b.y, lo)
    cv.drawLine(r.x, r.y, b.x, b.y, lo)

    // 依座標決定的固定紋理（磁磚顆粒）
    val grain = nativeFill(0xFF000000.toInt())
    grain.alpha = 30
    for (i in 0 until 2) {
        val h = texHash(x * 7919 + y * 104729 + i)
        val u = ((h ushr 3) and 255) / 255f
        val v = ((h ushr 11) and 255) / 255f
        val p = Offset(c.x + (u - 0.5f) * Iso.HALF_W * 1.4f, c.y + (v - 0.5f) * Iso.HALF_H * 1.4f)
        cv.drawCircle(p.x, p.y, 0.9f + v, grain)
    }

    when (tile) {
        "kitchen", "restroom" -> {
            val g = nativeStroke(0xFF000000.toInt(), 1.0f)
            g.alpha = 90
            val step = if (tile == "kitchen") 0.5f else 0.34f
            var k = step
            while (k < 1f) {
                val p0 = Iso.at(x - 0.5f + k, y - 0.5f)
                val p1 = Iso.at(x - 0.5f + k, y + 0.5f)
                cv.drawLine(p0.x, p0.y, p1.x, p1.y, g)
                val q0 = Iso.at(x - 0.5f, y - 0.5f + k)
                val q1 = Iso.at(x + 0.5f, y - 0.5f + k)
                cv.drawLine(q0.x, q0.y, q1.x, q1.y, g)
                k += step
            }
        }
        "pass", "door" -> {
            val g = nativeStroke(0xFF3a2513.toInt(), 1.1f)
            g.alpha = 150
            val p0 = Iso.at(x - 0.5f, y - 0.16f)
            val p1 = Iso.at(x + 0.5f, y - 0.16f)
            val q0 = Iso.at(x - 0.5f, y + 0.22f)
            val q1 = Iso.at(x + 0.5f, y + 0.22f)
            cv.drawLine(p0.x, p0.y, p1.x, p1.y, g)
            cv.drawLine(q0.x, q0.y, q1.x, q1.y, g)
        }
    }

    if (tile == "door") {
        val inner = Offset(c.x, c.y + Iso.HALF_H * 0.35f)
        cv.drawPath(nativePoly(inner + Offset(0f, -Iso.HALF_H * 0.45f), inner + Offset(Iso.HALF_W * 0.45f, 0f), inner + Offset(0f, Iso.HALF_H * 0.45f), inner + Offset(-Iso.HALF_W * 0.45f, 0f)), nativeFill(0xFF3d2a14.toInt()).apply { alpha = 190 })
    }
}

private fun DrawScope.drawPuddles(layout: com.dreamrestaurant.sim.Layout, frame: Long) {
    val lane = layout.sidewalk
    val ly = lane.y.toFloat()
    val x0 = (lane.x0 - 1).toFloat()
    val x1 = (lane.x1 + 1).toFloat()
    val span = (x1 - x0).coerceAtLeast(1f)
    for (i in 0 until 5) {
        val h = texHash(i * 977 + 13)
        val fx = x0 + (((h ushr 4) and 1023) / 1023f) * span
        val fy = ly - 0.85f + (((h ushr 14) and 255) / 255f) * 1.7f
        val p = Iso.at(fx, fy)
        val rx = 14f + ((h ushr 22) and 31)
        val ripple = (1f + kotlin.math.sin(frame * 0.18 + i) * 0.04).toFloat()
        drawOval(
            Color(0xFF6f9cd8).copy(alpha = 0.26f),
            topLeft = Offset(p.x - rx * ripple, p.y - rx * 0.42f * ripple),
            size = Size(rx * 2f * ripple, rx * 0.84f * ripple)
        )
        drawOval(
            Color(0xFFa9c8f2).copy(alpha = 0.30f),
            topLeft = Offset(p.x - rx * 0.62f * ripple, p.y - rx * 0.34f * ripple),
            size = Size(rx * 1.24f * ripple, rx * 0.5f * ripple)
        )
    }
}

/* ------------------------------------------------------- 椅子（等角小件） */

/** 椅子尺寸（邏輯像素）：和 `table` 的 15 高同一組基準，只是多了椅面與椅背 */
private const val CHAIR_LEG = 3.2f      // 椅腳粗
private const val CHAIR_LEG_H = 11f     // 椅面高（腳長）
private const val CHAIR_SLAB = 3.2f     // 椅面厚度
private const val CHAIR_PAD = 0.22f     // 椅腳離格子邊界的內縮（0.5 = 貼滿整格）
private const val CHAIR_BACK_H = 12f    // 椅柱從椅面再往上
private const val CHAIR_INSET = 0.28f   // 椅背離格子外緣的距離

private fun isChairItem(item: com.dreamrestaurant.sim.Item): Boolean =
    furnitureById(item.typeId)?.category == "chair"

/** 座標 → 座位 key（與 [occupiedSeatPositions] 對齊） */
private fun seatKey(x: Int, y: Int): Long = x.toLong() shl 32 or (y.toLong() and 0xFFFFFFFFL)

/** 正在「坐著」的顧客狀態 → 應該畫成坐姿並坐在椅子上 */
private fun isSeatedState(state: String): Boolean =
    state == "ordering" || state == "waitingFood" || state == "eating" || state == "paying"

/** 這一幀有哪些椅子上坐了人（顧客座標 ≈ 椅子座標） */
private fun occupiedSeatPositions(state: GameState): HashSet<Long> {
    val out = HashSet<Long>()
    for (c in state.sim.customers) {
        if (!isSeatedState(c.state)) continue
        out.add(seatKey(Math.round(c.x).toInt(), Math.round(c.y).toInt()))
    }
    return out
}

/**
 * 椅子朝向：`rotAuto`（由 `orientChairs` 依相鄰桌子算出來）優先，
 * 沒有的話退回手動的 `rot`。回傳 "S"/"E"/"N"/"W"，代表「椅子面向哪一邊」（＝桌子在那一側）。
 */
private fun chairFacingOf(item: com.dreamrestaurant.sim.Item): String =
    when ((item.rotAuto ?: item.rot) and 3) {
        0 -> "S"; 1 -> "E"; 2 -> "N"; else -> "W"
    }

/**
 * 畫一張等角椅子：四支腳 → 椅面厚板（木框＋坐墊）→ 背側的椅柱與橫桿。
 *
 * 朝向 [chairFacingOf] 決定椅背立在哪一側（桌子在的那一側），
 * 因此同一張桌子四周的椅子會自動圍成一圈；椅腳採 iso 內縮，和桌腳同一種畫法。
 */
private fun DrawScope.drawChair(
    item: com.dreamrestaurant.sim.Item,
    occupied: Boolean
) {
    val facing = chairFacingOf(item)
    val pal = paletteFor("chair")
    val seatCol = pal.first
    val frameHi = multiply(pal.first, 1.16f)
    val frameLo = pal.second
    val frameSh = pal.third
    val ns = facing == "S" || facing == "N"   // 椅背沿東西向（南北向的椅子）？

    // 1x1 格子的四個角（內縮 CHAIR_PAD）
    val gx0 = item.x - 0.5f + CHAIR_PAD
    val gx1 = item.x + item.w - 0.5f - CHAIR_PAD
    val gy0 = item.y - 0.5f + CHAIR_PAD
    val gy1 = item.y + item.h - 0.5f - CHAIR_PAD
    val cW = Iso.at(gx0, gy0)   // 西角（畫面左）
    val cS = Iso.at(gx1, gy0)   // 南角（畫面下）
    val cE = Iso.at(gx1, gy1)   // 東角（畫面右）
    val cN = Iso.at(gx0, gy1)   // 北角（畫面上）

    // 椅背立在哪條邊、前側是哪條邊
    val s0 = if (ns) cN else cE
    val s1 = if (ns) cE else cS
    val f0 = if (ns) cW else cN
    val f1 = if (ns) cS else cW

    // 椅腳：四個角各一支，離鏡頭近（螢幕 y 大）的先畫
    for ((b, t) in arrayOf(cW, cS, cE, cN).map { it to Offset(it.x, it.y - CHAIR_LEG_H) }
        .sortedBy { it.first.y }) {
        drawLine(frameSh, b, t, strokeWidth = CHAIR_LEG, cap = StrokeCap.Round)
    }
    // 前側橫撐：讓四支腳看起來是一張椅子而不是四根棍子
    val stretcherY = -CHAIR_LEG_H * 0.42f
    drawLine(
        frameLo, Offset(f0.x, f0.y + stretcherY), Offset(f1.x, f1.y + stretcherY),
        strokeWidth = CHAIR_LEG * 0.62f, cap = StrokeCap.Round
    )

    // 椅面：iso 菱形厚板（側面 → 木框 → 內縮的坐墊）
    val slabTop = -CHAIR_LEG_H
    val quadTop = arrayOf(cW, cS, cE, cN).map { Offset(it.x, it.y + slabTop) }
    for (i in intArrayOf(if (ns) 1 else 2, if (ns) 2 else 3)) {
        val p0 = quadTop[i]
        val p1 = quadTop[(i + 1) % 4]
        drawPath(
            poly(p0, p1, Offset(p1.x, p1.y - CHAIR_SLAB), Offset(p0.x, p0.y - CHAIR_SLAB)),
            frameSh
        )
    }
    drawPath(poly(quadTop[0], quadTop[1], quadTop[2], quadTop[3]), multiply(seatCol, 0.78f))
    val ccx = (cW.x + cE.x) / 2f
    val ccy = (cW.y + cE.y) / 2f
    val inner = quadTop.map { Offset(ccx + (it.x - ccx) * 0.80f, ccy + (it.y - ccy) * 0.80f) }
    drawPath(poly(inner[0], inner[1], inner[2], inner[3]), seatCol)
    drawPath(poly(inner[0], inner[1], inner[2], inner[3]), multiply(seatCol, 0.62f), style = Stroke(1f))
    // 坐墊高光（靠畫面上緣的兩邊）與暗面（下方兩邊）
    drawLine(multiply(seatCol, 1.20f), inner[0], inner[1], strokeWidth = 1.4f)
    drawLine(multiply(seatCol, 1.10f), inner[0], inner[3], strokeWidth = 1.2f)
    drawLine(multiply(seatCol, 0.74f), inner[1], inner[2], strokeWidth = 1.2f)
    drawLine(multiply(seatCol, 0.74f), inner[2], inner[3], strokeWidth = 1.2f)
    drawPath(poly(quadTop[0], quadTop[1], quadTop[2], quadTop[3]), multiply(frameSh, 0.62f), style = Stroke(1f))
    if (occupied) {
        // 坐凹：兩道短橫線暗示重量壓在坐墊上
        drawLine(
            multiply(seatCol, 0.55f),
            Offset(ccx - 5f, ccy + 1.5f), Offset(ccx + 5f, ccy + 1.5f), strokeWidth = 1.6f
        )
        drawLine(
            multiply(seatCol, 0.70f),
            Offset(ccx - 3.5f, ccy + 3.2f), Offset(ccx + 3.5f, ccy + 3.2f), strokeWidth = 1.2f
        )
    }

    // 椅背：兩根柱 + 三根橫桿，立在背側（桌子在的那一側）
    val pad = CHAIR_INSET
    val postA0 = if (ns) Iso.at(gx0 + pad, gy1 - pad) else Iso.at(gx1 - pad, gy0 + pad)
    val postB0 = if (ns) Iso.at(gx1 - pad, gy1 - pad) else Iso.at(gx1 - pad, gy1 - pad)
    val pa = Offset(postA0.x, postA0.y + slabTop)
    val pb = Offset(postB0.x, postB0.y + slabTop)
    val paTop = Offset(pa.x, pa.y - CHAIR_BACK_H)
    val pbTop = Offset(pb.x, pb.y - CHAIR_BACK_H)
    // 背柱擺在椅面的背側角落，往畫面外偏一點，才不會和坐墊糊在一起
    val outA = if (ns) Offset(0f, -1.2f) else Offset(1.2f, 0f)
    val outB = if (ns) Offset(0f, -1.2f) else Offset(1.2f, 0f)
    drawLine(frameSh, pa + outA, paTop + outA, strokeWidth = CHAIR_LEG, cap = StrokeCap.Round)
    drawLine(frameSh, pb + outB, pbTop + outB, strokeWidth = CHAIR_LEG, cap = StrokeCap.Round)
    val railOffsets = floatArrayOf(-CHAIR_BACK_H + 3.0f, -CHAIR_BACK_H * 0.58f, -1.6f)
    for ((ri, dy) in railOffsets.withIndex()) {
        val a = Offset(pa.x + outA.x, pa.y + outA.y + dy)
        val b = Offset(pb.x + outB.x, pb.y + outB.y + dy)
        val col = if (ri == 1) frameHi else frameLo
        drawLine(multiply(frameSh, 0.66f), a, b, strokeWidth = CHAIR_LEG + 1.8f, cap = StrokeCap.Round)
        drawLine(col, a, b, strokeWidth = CHAIR_LEG, cap = StrokeCap.Round)
    }
    drawLine(multiply(frameHi, 1.08f), paTop + outA, pbTop + outB, strokeWidth = 1.3f, cap = StrokeCap.Round)
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
    // 立體輪廓：上緣描一道，三條直邊（左外、前、右外）加深
    drawPath(poly(a + up, b + up, c + up, d + up), multiply(top, 0.82f), style = Stroke(1f))
    drawLine(multiply(left, 0.72f), d, d + up, strokeWidth = 1f)
    drawLine(multiply(right, 0.72f), b, b + up, strokeWidth = 1f)
    drawLine(multiply(right, 0.55f), c, c + up, strokeWidth = 1.2f)
}

private fun DrawScope.drawCustomer(
    c: com.dreamrestaurant.core.Customer, idx: Int, frame: Long, tm: TextMeasurer
) {
    // 坐著的人畫在椅子位置上：椅子先畫，人疊上去看起來就是坐在椅子上
    val seated = isSeatedState(c.state)
    val p = Iso.at(c.x, c.y)
    val walking = c.state == "arriving" || c.state == "leaving" ||
        c.state == "angry" || c.state == "toSeat"
    // 客人和桌椅同一個尺度（0.95），才不會像小人國；同行人數用頭頂徽章表示
    val scale = 0.95f
    drawFigure(
        px = p.x, py = p.y, scale = scale, frame = frame, seed = idx, walking = walking,
        torso = moodColor(c.mood),
        skin = Color(SKINS[idx % SKINS.size]),
        hair = Color(HAIRS[(idx * 7) % HAIRS.size]),
        seated = seated
    )
    if (c.bubble != null) {
        drawCircle(
            Color(0xFFFFC107),
            radius = 9.5f * scale,
            center = p - Offset(0f, 25.5f * scale),
            style = Stroke(1.6f)
        )
    }

    // 頭頂資訊：由下往上堆疊（訂單 → 同伴人數）；坐姿的頭比較低，標籤跟著降
    var top = p.y - (if (seated) 28f else 33f) * scale
    if (c.state in ORDER_LABEL_STATES && c.order.isNotEmpty()) {
        val label = orderLabel(c)
        if (label.isNotEmpty()) {
            val res = tm.measure(label, orderLabelStyle())
            val w = res.size.width + 9f
            val h = res.size.height + 5f
            val tl = Offset(p.x - w / 2f, top - h)
            drawRoundRect(Color(0xF2141B2E), topLeft = tl, size = Size(w, h), cornerRadius = CornerRadius(4f, 4f))
            drawRoundRect(
                Color(0xFF64B5F6), topLeft = tl, size = Size(w, h),
                cornerRadius = CornerRadius(4f, 4f), style = Stroke(1f)
            )
            drawText(res, topLeft = Offset(tl.x + 4.5f, tl.y + 2.5f))
            top = tl.y - 3f
        }
    }
    if (c.partySize > 1) {
        // 同行客人數：頭頂徽章（2 人以上才顯示，1 人不需要）
        val res = tm.measure("${c.partySize}", partyBadgeStyle())
        val w = res.size.width + 7f
        val h = res.size.height + 4f
        val tl = Offset(p.x - w / 2f, top - h)
        drawRoundRect(Color(0xFF64B5F6), topLeft = tl, size = Size(w, h), cornerRadius = CornerRadius(3.5f, 3.5f))
        drawRoundRect(
            Color(0xFF0e1426).copy(alpha = 0.55f), topLeft = tl, size = Size(w, h),
            cornerRadius = CornerRadius(3.5f, 3.5f), style = Stroke(1f)
        )
        drawText(res, topLeft = Offset(tl.x + 3.5f, tl.y + 2f))
    }
}

/** 顯示訂單的狀態（點完餐 → 用餐 → 付帳） */
private val ORDER_LABEL_STATES = setOf("waitingFood", "eating", "paying")

/**
 * 訂單標籤內容：同名料理合併成「名字×數量」，最多 3 種（超過的用 +N 表示），
 * 每個名字最多 6 個字，避免標籤蓋住整個畫面。
 */
private fun orderLabel(c: com.dreamrestaurant.core.Customer): String {
    val counts = LinkedHashMap<String, Int>()
    for (line in c.order) {
        val name = getDish(line.dishId)?.name ?: continue
        counts[name] = (counts[name] ?: 0) + 1
    }
    if (counts.isEmpty()) return ""
    val lines = ArrayList<String>(4)
    for ((name, n) in counts.entries.take(3)) {
        val base = if (name.length > 6) name.take(6) + "…" else name
        lines += if (n > 1) "$base×$n" else base
    }
    if (counts.size > 3) lines += "+${counts.size - 3}"
    return lines.joinToString("\n")
}

// 字級用 px（toSp 把畫布像素換算成 sp），才不會被裝置密度放大成巨字
private fun DrawScope.orderLabelStyle() =
    TextStyle(color = Color(0xFFEDEFF7), fontSize = 9f.toSp(), fontWeight = FontWeight.Medium)

private fun DrawScope.partyBadgeStyle() =
    TextStyle(color = Color(0xFF0e1426), fontSize = 9f.toSp(), fontWeight = FontWeight.Bold)

private fun DrawScope.drawStaff(s: com.dreamrestaurant.core.HiredStaff, idx: Int, frame: Long) {
    val p = Iso.at(s.x, s.y)
    val chef = s.role == "chef"
    val body = if (chef) Color(0xFFFF9800) else Color(0xFF26C6DA)
    val walking = s.state == "toTask"
    drawFigure(
        px = p.x, py = p.y, scale = 1.15f, frame = frame, seed = idx + 31, walking = walking,
        torso = body,
        skin = Color(SKINS[(idx + 2) % SKINS.size]),
        hair = Color(HAIRS[(idx * 5) % HAIRS.size]),
        hat = if (chef) Color(0xFFf4f6fb) else null, dim = s.state == "off"
    )
    if (s.state == "off") {
        drawLine(Color(0xFF90A4AE), p - Offset(6f, 26f), p - Offset(-6f, 6f), strokeWidth = 2f)
    }
}

private fun DrawScope.drawWalker(w: com.dreamrestaurant.core.Walker) {
    val p = Iso.at(w.x, w.y)
    drawFigure(
        px = p.x, py = p.y, scale = 0.95f, frame = 0L, seed = 7, walking = true,
        torso = Color(0xFF9E9E9E), skin = Color(SKINS[0]), hair = Color(0xFF3b3f4d)
    )
}

/**
 * 通用小人：腿（走路擺動）＋身軀＋手臂＋頭＋頭髮（＋可選帽子）。
 * 座標以腳底 [py] 為地面基準，尺寸隨 [scale] 縮放。
 *
 * [seated] = true 時畫成坐姿（對應 `sprites.js` 的 `off = 9` 坐姿下移）：
 * 大腿水平往前、小腿在椅面邊緣垂下、腳掌踩在地板上，
 * 髖部高度對齊椅面（[CHAIR_LEG_H]），所以人看起來是「坐在椅子上」而不是浮在半空中。
 */
private fun DrawScope.drawFigure(
    px: Float, py: Float, scale: Float, frame: Long, seed: Int, walking: Boolean,
    torso: Color, skin: Color, hair: Color,
    hat: Color? = null, dim: Boolean = false, seated: Boolean = false
) {
    val ph = frame * 0.42 + seed * 1.7
    val swing = if (walking && !seated) kotlin.math.sin(ph).toFloat() * 4.5f * scale else 0f
    val bob = if (walking && !seated) kotlin.math.abs(kotlin.math.sin(ph * 2)).toFloat() * 1.3f * scale else 0f

    // 坐姿：髖部抬到椅面上方一點點（坐墊會壓出凹陷），肩線與頭跟著上移
    val hipY = py - (if (seated) CHAIR_LEG_H + 5.0f else 10f) * scale - bob
    val shoY = py - (if (seated) CHAIR_LEG_H + 15.0f else 20f) * scale - bob
    val headY = py - (if (seated) CHAIR_LEG_H + 20.5f else 25.5f) * scale - bob
    val headR = 5.2f * scale
    val outline = Color(0xFF0e1426)
    val legC = multiply(torso, 0.66f)
    val footY = py - kotlin.math.abs(swing) * 0.3f

    if (seated) {
        // 大腿：從髖部往前伸（螢幕左上→右下＝畫面裡的「前方」），末端當膝蓋
        val kneeY = py - 4.6f * scale
        val lkx = px - 4.6f * scale
        val rkx = px + 4.6f * scale
        drawLine(legC, Offset(px - 1.2f * scale, hipY), Offset(lkx, kneeY), strokeWidth = 4.0f * scale, cap = StrokeCap.Round)
        drawLine(legC, Offset(px + 1.2f * scale, hipY), Offset(rkx, kneeY), strokeWidth = 4.0f * scale, cap = StrokeCap.Round)
        // 小腿：膝蓋 → 腳掌（幾乎垂直落地，才像坐在椅子上）
        drawLine(legC, Offset(lkx, kneeY), Offset(lkx - 0.5f * scale, py - 0.8f * scale), strokeWidth = 3.2f * scale, cap = StrokeCap.Round)
        drawLine(legC, Offset(rkx, kneeY), Offset(rkx + 0.5f * scale, py - 0.8f * scale), strokeWidth = 3.2f * scale, cap = StrokeCap.Round)
    } else {
        // 腳
        drawLine(legC, Offset(px, hipY), Offset(px - 3.2f * scale + swing, footY), strokeWidth = 3.4f * scale, cap = StrokeCap.Round)
        drawLine(legC, Offset(px, hipY), Offset(px + 3.2f * scale - swing, footY), strokeWidth = 3.4f * scale, cap = StrokeCap.Round)
    }

    // 手臂（在身軀底下）
    val armC = multiply(torso, 0.82f)
    drawLine(armC, Offset(px - 5.5f * scale, shoY + 4f * scale), Offset(px - 6.5f * scale - swing * 0.5f, hipY + 1f), strokeWidth = 2.8f * scale, cap = StrokeCap.Round)
    drawLine(armC, Offset(px + 5.5f * scale, shoY + 4f * scale), Offset(px + 6.5f * scale + swing * 0.5f, hipY + 1f), strokeWidth = 2.8f * scale, cap = StrokeCap.Round)

    // 身軀
    val bw = 11f * scale
    val bh = (hipY - shoY) + if (seated) 6.5f * scale else 4f * scale
    val bodyTop = Offset(px - bw / 2f, shoY)
    val bodySize = Size(bw, bh)
    val rad = CornerRadius(bw * 0.45f, bw * 0.45f)
    drawRoundRect(torso, topLeft = bodyTop, size = bodySize, cornerRadius = rad)
    // 背心／圍裙
    drawRoundRect(
        multiply(torso, 1.18f),
        topLeft = Offset(px - bw * 0.28f, shoY + 2f * scale),
        size = Size(bw * 0.56f, bh * 0.72f),
        cornerRadius = CornerRadius(2f, 2f)
    )
    drawRoundRect(outline.copy(alpha = 0.35f), topLeft = bodyTop, size = bodySize, cornerRadius = rad, style = Stroke(1f))

    // 頭
    drawCircle(skin, headR, Offset(px, headY))
    drawArc(
        hair, 180f, 180f, useCenter = true,
        topLeft = Offset(px - headR, headY - headR),
        size = Size(headR * 2f, headR * 2f)
    )
    drawCircle(outline.copy(alpha = 0.85f), headR, Offset(px, headY), style = Stroke(1.2f))

    // 帽子
    if (hat != null) {
        drawRoundRect(
            hat,
            topLeft = Offset(px - headR * 0.95f, headY - headR * 1.75f),
            size = Size(headR * 1.9f, headR * 1.0f),
            cornerRadius = CornerRadius(headR * 0.35f, headR * 0.35f)
        )
        drawRoundRect(
            outline.copy(alpha = 0.45f),
            topLeft = Offset(px - headR * 0.95f, headY - headR * 1.75f),
            size = Size(headR * 1.9f, headR * 1.0f),
            cornerRadius = CornerRadius(headR * 0.35f, headR * 0.35f),
            style = Stroke(1f)
        )
    }

    if (dim) drawRect(Color(0xFF0e1426).copy(alpha = 0.35f), topLeft = Offset(px - 12f, headY - headR * 2.2f), size = Size(24f, 34f))
}

/** 用於標示同行人數的小圓牌（避免引入文字測量，直接畫數字線條太複雜 → 用點陣） */
private fun DrawScope.drawWallPiece(
    layout: Layout, x: Int, y: Int, base: Color, gw: Int, gh: Int
) {
    val top = multiply(base, 1.14f)
    val left = multiply(base, 0.84f)
    val right = multiply(base, 0.66f)
    drawBox(x, y, 1, 1, Iso.WALL_H, top, left, right)

    val a = Iso.at(x - 0.5f, y - 0.5f)
    val b = Iso.at(x + 0.5f, y - 0.5f)
    val c = Iso.at(x + 0.5f, y + 0.5f)
    val d = Iso.at(x - 0.5f, y + 0.5f)
    val up = Offset(0f, -Iso.WALL_H)

    // 踢腳板
    val trim = Offset(0f, -7f)
    drawPath(poly(c, d, d + trim, c + trim), multiply(left, 0.60f))
    drawPath(poly(b, c, c + trim, b + trim), multiply(right, 0.60f))

    // 牆頂亮邊
    drawPath(poly(a + up, b + up, c + up, d + up), multiply(top, 1.12f), style = Stroke(1.5f))

    // 外牆才開窗，且隔一格開一扇（不然整面玻璃牆太密）
    if (tileAt(layout, x + 1, y) == "void" && (x + y) % 2 == 0) drawWallWindow(b, c)
    if (tileAt(layout, x, y + 1) == "void" && (x + y) % 2 == 0) drawWallWindow(d, c)
}

/** 在 [p0]→[p1] 的牆面底邊上畫一扇窗（含窗框、玻璃、斜向高光） */
private fun DrawScope.drawWallWindow(p0: Offset, p1: Offset) {
    fun lp(t: Float, up: Float) = Offset(
        p0.x + (p1.x - p0.x) * t,
        p0.y + (p1.y - p0.y) * t - up
    )
    val frame = Color(0xFF4a3b28)
    val v0 = Iso.WALL_H * 0.40f
    val v1 = Iso.WALL_H * 0.86f
    drawPath(poly(lp(0.20f, v0), lp(0.80f, v0), lp(0.80f, v1), lp(0.20f, v1)), frame)

    val g0 = lp(0.25f, v0 + 5f)
    val g1 = lp(0.75f, v0 + 5f)
    val g2 = lp(0.75f, v1 - 5f)
    val g3 = lp(0.25f, v1 - 5f)
    drawPath(poly(g0, g1, g2, g3), Color(0xFF8fb6dd))
    // 天光／夜色漸層：上半亮、下半暗
    val mid0 = lp(0.25f, (v0 + 5f + v1 - 5f) / 2f)
    val mid1 = lp(0.75f, (v0 + 5f + v1 - 5f) / 2f)
    drawPath(poly(mid0, mid1, g2, g3), Color(0xFF6f9bc6))
    // 玻璃高光
    drawLine(
        Color.White.copy(alpha = 0.55f),
        lp(0.34f, v0 + 10f),
        lp(0.52f, v1 - 9f),
        strokeWidth = 2f
    )
    drawLine(
        Color.White.copy(alpha = 0.30f),
        lp(0.56f, v0 + 10f),
        lp(0.68f, v1 - 9f),
        strokeWidth = 1.4f
    )
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

/* --------------------------------------------------- 離屏烘焙用的原生畫筆 */

private fun nativeFill(argb: Int): android.graphics.Paint =
    android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
        style = android.graphics.Paint.Style.FILL
        color = argb
    }

private fun nativeStroke(argb: Int, width: Float): android.graphics.Paint =
    android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
        style = android.graphics.Paint.Style.STROKE
        strokeWidth = width
        strokeCap = android.graphics.Paint.Cap.ROUND
        color = argb
    }

private fun nativePoly(p0: Offset, p1: Offset, p2: Offset, p3: Offset): android.graphics.Path =
    android.graphics.Path().apply {
        moveTo(p0.x, p0.y)
        lineTo(p1.x, p1.y)
        lineTo(p2.x, p2.y)
        lineTo(p3.x, p3.y)
        close()
    }

/* ------------------------------------------------------------ 固定雜訊 */

private fun texHash(n: Int): Int {
    var h = n
    h = h xor (h ushr 16)
    h *= 0x7feb352d
    h = h xor (h ushr 15)
    h *= 0x846ca68b.toInt()
    h = h xor (h ushr 16)
    return h
}

private fun texHashF(i: Int, salt: Int): Float {
    val h = texHash(i * 374761393 + salt * 668265263)
    return ((h ushr 8) and 0xffffff).toFloat() / 16777216f
}

/* ------------------------------------------------------------ 接地陰影 */

private fun DrawScope.contactShadow(p: Offset, rx: Float, ry: Float, alpha: Float) {
    drawOval(
        Color(0xFF000000).copy(alpha = alpha),
        topLeft = Offset(p.x - rx, p.y - ry),
        size = Size(rx * 2f, ry * 2f)
    )
}

private val SKINS = intArrayOf(
    0xFFf6d7b0.toInt(), 0xFFe8bd94.toInt(), 0xFFd2a077.toInt(), 0xFFb9835a.toInt()
)

private val HAIRS = intArrayOf(
    0xFF2a2731.toInt(), 0xFF3d2b1f.toInt(), 0xFF6b4423.toInt(), 0xFF171820.toInt(), 0xFFa9793f.toInt()
)

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
