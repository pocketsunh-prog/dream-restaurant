package com.dreamrestaurant.ui.panels

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dreamrestaurant.core.B
import com.dreamrestaurant.core.GameAction
import com.dreamrestaurant.core.GameState
import com.dreamrestaurant.core.MenuPatch
import com.dreamrestaurant.data.DISHES
import com.dreamrestaurant.data.FURNITURE
import com.dreamrestaurant.data.getDish
import com.dreamrestaurant.data.getLocation
import com.dreamrestaurant.data.staffById
import com.dreamrestaurant.ui.GameRunner
import com.dreamrestaurant.ui.audio.GameAudio
import java.util.Locale

/* ------------------------------------------------------------- 面板入口 */

val PANEL_IDS = listOf("menu", "staff", "build", "report", "env", "system")

val PANEL_TITLES = mapOf(
    "menu" to "菜單進貨",
    "staff" to "員工",
    "build" to "裝潢設備",
    "report" to "報表",
    "env" to "環境",
    "system" to "系統"
)

private fun tabsOf(id: String): List<String> = when (id) {
    "menu" -> listOf("菜單", "進貨")
    "staff" -> listOf("現有員工", "招募", "排班")
    "build" -> listOf("添購", "現有傢俱", "清潔維修", "廚房")
    "report" -> listOf("今日", "歷史", "雜誌", "評價")
    "env" -> listOf("營業", "空調", "音樂", "畫面", "配色")
    "system" -> listOf("存讀檔", "統計", "說明")
    else -> emptyList()
}

/* --------------------------------------------------------------- 工具列 */

@Composable
fun PanelBar(runner: GameRunner) {
    val frame = runner.frame
    Row(
        Modifier
            .fillMaxWidth()
            .background(Color(0xFF101728))
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Text("功能", color = Color(0xFF8494b8), fontSize = 11.sp)
        for (id in PANEL_IDS) {
            val open = runner.openPanel == id
            SmallChip(PANEL_TITLES.getValue(id), selected = open) {
                GameAudio.sfx("click")
                runner.togglePanel(id)
            }
        }
        @Suppress("UNUSED_EXPRESSION")
        frame
    }
}

/* --------------------------------------------------------------- 覆蓋層 */

@Composable
fun PanelOverlay(runner: GameRunner) {
    // 讀 frame：模擬每 tick 前進，面板裡的數字也要跟著跳
    val frame = runner.frame
    val state = runner.state()
    val id = runner.openPanel ?: return
    val tab = remember(id) { mutableIntStateOf(0) }
    val tabs = tabsOf(id)

    Column(
        Modifier
            .fillMaxSize()
            .background(Color(0xFF0b1020))
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(Color(0xFF151c36))
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                PANEL_TITLES[id] ?: id,
                color = Color.White,
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.weight(1f))
            OutlinedButton(
                onClick = {
                    GameAudio.sfx("close")
                    runner.closePanel()
                },
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 4.dp),
                border = BorderStroke(1.dp, Color(0xFF3a466b))
            ) { Text("關閉", color = Color(0xFFc8d4ee), fontSize = 13.sp) }
        }

        if (tabs.size > 1) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF0f1526))
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                tabs.forEachIndexed { i, t ->
                    SmallChip(t, selected = tab.intValue == i) { tab.intValue = i }
                }
            }
        }

        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(12.dp)
        ) {
            when (id) {
                "menu" -> when (tab.intValue) {
                    0 -> MenuTab(runner, state)
                    else -> StockTab(runner, state)
                }
                "staff" -> when (tab.intValue) {
                    0 -> StaffExistingTab(runner, state)
                    1 -> StaffHireTab(runner, state)
                    else -> StaffShiftTab(runner, state)
                }
                "build" -> when (tab.intValue) {
                    0 -> BuildBuyTab(runner, state)
                    1 -> BuildItemsTab(runner, state)
                    2 -> BuildMaintTab(runner, state)
                    else -> BuildKitchenTab(runner, state)
                }
                "report" -> when (tab.intValue) {
                    0 -> ReportTodayTab(runner, state)
                    1 -> ReportHistoryTab(runner, state)
                    2 -> ReportMagazineTab(runner, state)
                    else -> ReportRatingTab(runner, state)
                }
                "env" -> when (tab.intValue) {
                    0 -> EnvHoursTab(runner, state)
                    1 -> EnvAcTab(runner, state)
                    2 -> EnvMusicTab(runner, state)
                    3 -> EnvFxTab(runner, state)
                    else -> EnvColorTab(runner, state)
                }
                "system" -> when (tab.intValue) {
                    0 -> SystemSaveTab(runner, frame)
                    1 -> SystemStatsTab(runner, state)
                    else -> SystemHelpTab()
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

/* --------------------------------------------------------------- 元件 */

@Composable
private fun CardBox(title: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Color(0xFF151c36))
            .padding(10.dp)
    ) {
        if (title != null) {
            Text(title, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
        }
        content()
    }
    Spacer(Modifier.height(10.dp))
}

@Composable
private fun KV(label: String, value: String, valueColor: Color = Color.White) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(label, color = Color(0xFF8494b8), fontSize = 12.sp, modifier = Modifier.width(96.dp))
        Text(value, color = valueColor, fontSize = 13.sp)
    }
}

@Composable
private fun Act(
    text: String,
    enabled: Boolean = true,
    compact: Boolean = true,
    onClick: () -> Unit
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        contentPadding = if (compact) PaddingValues(horizontal = 10.dp, vertical = 2.dp)
        else PaddingValues(horizontal = 14.dp, vertical = 6.dp),
        border = BorderStroke(1.dp, if (enabled) Color(0xFF3a466b) else Color(0xFF232a44))
    ) {
        Text(
            text,
            fontSize = if (compact) 12.sp else 13.sp,
            color = if (enabled) Color(0xFFc8d4ee) else Color(0xFF5b6480)
        )
    }
}

@Composable
private fun SmallChip(text: String, selected: Boolean, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 3.dp),
        border = BorderStroke(1.dp, if (selected) Color(0xFF64B5F6) else Color(0xFF3a466b)),
        modifier = if (selected) Modifier.background(Color(0xFF64B5F6)) else Modifier
    ) {
        Text(
            text,
            fontSize = 12.sp,
            color = if (selected) Color(0xFF0e1426) else Color(0xFFc8d4ee)
        )
    }
}

@Composable
private fun Stepper(
    label: String,
    value: String,
    onMinus: () -> Unit,
    onPlus: () -> Unit,
    enabled: Boolean = true
) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, color = Color(0xFF8494b8), fontSize = 12.sp, modifier = Modifier.width(96.dp))
        Act("－", enabled = enabled, onClick = onMinus)
        Spacer(Modifier.width(8.dp))
        Text(
            value,
            color = Color.White,
            fontSize = 13.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.width(92.dp)
        )
        Spacer(Modifier.width(8.dp))
        Act("＋", enabled = enabled, onClick = onPlus)
    }
}

@Composable
private fun ToggleRow(label: String, on: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, color = Color(0xFF8494b8), fontSize = 12.sp, modifier = Modifier.weight(1f))
        SmallChip(if (on) "開" else "關", selected = on, onClick = onToggle)
    }
}

private fun money(v: Number): String =
    String.format(Locale.US, "%,d", v.toLong())

private fun moneyD(v: Double): String =
    String.format(Locale.US, "%,d", v.toLong())

private fun hhmm(minute: Int): String {
    val m = ((minute % 1440) + 1440) % 1440
    return String.format(Locale.US, "%02d:%02d", m / 60, m % 60)
}

private fun roleName(role: String): String = when (role) {
    "chef" -> "廚師"
    "waiter" -> "服務生"
    "cashier" -> "收銀"
    "cleaner" -> "清潔"
    else -> role
}

private fun dishCategory(cat: String): String = when (cat) {
    "staple" -> "主食"
    "side" -> "副食"
    "soup" -> "湯品"
    "drink" -> "飲料"
    "alcohol" -> "酒類"
    "dessert" -> "甜點"
    "secret" -> "隱藏版"
    else -> cat
}

/* ------------------------------------------------------------ 菜單 / 進貨 */

@Composable
private fun MenuTab(runner: GameRunner, state: GameState) {
    CardBox {
        KV("菜單數量", "${state.menu.size} / ${state.menuLimit}")
        KV("現金", "NT$ ${moneyD(state.cash)}")
        if (state.menu.isEmpty()) {
            Spacer(Modifier.height(4.dp))
            Text(
                "菜單是空的：先從下面加入幾道菜，再按右下角「進貨」補庫存。",
                color = Color(0xFF9fb0d0),
                fontSize = 12.sp
            )
        }
    }

    for (dish in DISHES) {
        val unlocked = dish.unlockStars <= state.stars
        val entry = state.menu.firstOrNull { it.dishId == dish.id }
        if (!unlocked && entry == null) continue

        CardBox {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        dish.name,
                        color = if (unlocked) Color.White else Color(0xFF8494b8),
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium
                    )
                    Text(
                        "${dishCategory(dish.category)} · 建議售價 NT$ ${dish.expectedPrice}" +
                            if (!unlocked) " · ${dish.unlockStars} 星解鎖" else "",
                        color = Color(0xFF8494b8),
                        fontSize = 11.sp
                    )
                }
                if (entry == null) {
                    Act("加入菜單", enabled = unlocked && state.menu.size < state.menuLimit) {
                        runner.dispatch(GameAction.MenuAdd(dish.id))
                    }
                }
            }

            if (entry != null) {
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("售價", color = Color(0xFF8494b8), fontSize = 12.sp, modifier = Modifier.width(56.dp))
                    Act("－20") {
                        runner.dispatch(
                            GameAction.MenuUpdate(dish.id, MenuPatch(price = (entry.price - 20).coerceAtLeast(1)))
                        )
                    }
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "NT$ ${entry.price}",
                        color = Color.White,
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.width(76.dp)
                    )
                    Spacer(Modifier.width(6.dp))
                    Act("＋20") {
                        runner.dispatch(
                            GameAction.MenuUpdate(dish.id, MenuPatch(price = entry.price + 20))
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    Text(
                        "庫存 ${state.stock[dish.id] ?: 0}",
                        color = if ((state.stock[dish.id] ?: 0) > 0) Color(0xFF66BB6A) else Color(0xFFFF8A80),
                        fontSize = 12.sp
                    )
                }
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Act(if (entry.active) "停售" else "恢復販售") {
                        runner.dispatch(GameAction.MenuToggle(dish.id))
                    }
                    Act("移出菜單") {
                        runner.dispatch(GameAction.MenuRemove(dish.id))
                    }
                }
            }
        }
    }

    val locked = DISHES.count { it.unlockStars > state.stars }
    if (locked > 0) {
        CardBox("尚未解鎖") {
            Text(
                "還有 $locked 道菜等著升星解鎖（目前 ${state.stars} 星）。",
                color = Color(0xFF8494b8),
                fontSize = 12.sp
            )
        }
    }
}

@Composable
private fun StockTab(runner: GameRunner, state: GameState) {
    CardBox("庫存") {
        if (state.menu.isEmpty()) {
            Text("菜單裡沒有品項可進貨。", color = Color(0xFF8494b8), fontSize = 12.sp)
        }
        for (entry in state.menu) {
            val dish = getDish(entry.dishId)
            val have = state.stock[entry.dishId] ?: 0
            Row(
                Modifier.fillMaxWidth().padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(dish?.name ?: entry.dishId, color = Color.White, fontSize = 13.sp)
                    Text(
                        "庫存 $have 份",
                        color = if (have > 0) Color(0xFF66BB6A) else Color(0xFFFF8A80),
                        fontSize = 11.sp
                    )
                }
                Act("進貨 10") { runner.dispatch(GameAction.BuyStock(entry.dishId, 10)) }
                Spacer(Modifier.width(6.dp))
                Act("進貨 50") { runner.dispatch(GameAction.BuyStock(entry.dishId, 50)) }
            }
        }
    }

    CardBox("在途訂單") {
        if (state.suppliers.isEmpty()) {
            Text("目前沒有在途的貨。", color = Color(0xFF8494b8), fontSize = 12.sp)
        }
        for (s in state.suppliers) {
            val left = (s.arriveMinute - state.absMinute).coerceAtLeast(0.0)
            Row(
                Modifier.fillMaxWidth().padding(vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    getDish(s.dishId)?.name ?: s.dishId,
                    color = Color.White,
                    fontSize = 13.sp,
                    modifier = Modifier.weight(1f)
                )
                Text("×${s.servings}", color = Color(0xFFc8d4ee), fontSize = 12.sp)
                Spacer(Modifier.width(10.dp))
                Text(
                    String.format(Locale.US, "約 %d 分鐘後", left.toInt()),
                    color = Color(0xFF8494b8),
                    fontSize = 12.sp
                )
                Spacer(Modifier.width(10.dp))
                Text("NT$ ${money(s.cost)}", color = Color(0xFF8494b8), fontSize = 12.sp)
            }
        }
    }

    CardBox("價格提醒") {
        Text(
            "供應商偶爾會調價，促銷期間進貨比較便宜。停售的菜不會被點，但也不會消耗庫存。",
            color = Color(0xFF8494b8),
            fontSize = 12.sp
        )
    }
}

/* ---------------------------------------------------------------- 員工 */

@Composable
private fun StaffExistingTab(runner: GameRunner, state: GameState) {
    CardBox {
        KV("員工數", "${state.staff.size} 人")
        KV("每日薪資支出", "NT$ ${money(state.staff.sumOf { it.wage })}")
    }
    if (state.staff.isEmpty()) {
        CardBox {
            Text(
                "還沒有員工。到「招募」標籤看看今天的應徵者。",
                color = Color(0xFF8494b8),
                fontSize = 12.sp
            )
        }
    }
    for (s in state.staff) {
        CardBox(s.name) {
            KV("職務", roleName(s.role))
            KV(
                "狀態",
                when (s.state) {
                    "idle" -> "待命"
                    "toTask" -> "前往工作"
                    "cooking" -> "烹調中"
                    "off" -> "休息中"
                    else -> s.state
                }
            )
            KV("心情", "${s.mood.toInt()} / 100")
            KV("疲勞", "${s.fatigue.toInt()}")
            Spacer(Modifier.height(4.dp))
            Stepper(
                "日薪",
                "NT$ ${money(s.wage)}",
                onMinus = { runner.dispatch(GameAction.SetWage(s.uid, s.wage - 100)) },
                onPlus = { runner.dispatch(GameAction.SetWage(s.uid, s.wage + 100)) }
            )
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Act("解僱") { runner.dispatch(GameAction.Fire(s.uid)) }
            }
        }
    }
}

@Composable
private fun StaffHireTab(runner: GameRunner, state: GameState) {
    CardBox("今日應徵者") {
        Text(
            "簽約金為開價的兩倍；薪資會影響心情。",
            color = Color(0xFF8494b8),
            fontSize = 12.sp
        )
    }
    if (state.candidates.isEmpty()) {
        CardBox {
            Text("今天沒有應徵者（隔天會刷新）。", color = Color(0xFF8494b8), fontSize = 12.sp)
        }
    }
    for (c in state.candidates) {
        val def = staffById(c.staffId) ?: continue
        CardBox(def.name) {
            KV("職務", roleName(def.role))
            KV("能力", "速度 ${def.speed} ｜ 技巧 ${def.skill} ｜ 體力 ${def.stamina}")
            KV("專長", def.specialty)
            KV("開價", "NT$ ${c.askWage} / 天")
            KV("簽約金", "NT$ ${money(c.askWage * 2)}")
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Act("僱用", compact = false) { runner.dispatch(GameAction.Hire(c.candidateId)) }
                if (state.staff.isEmpty()) {
                    Text("至少要有一位廚師與一位服務生", color = Color(0xFFFF8A80), fontSize = 11.sp)
                }
            }
        }
    }
}

@Composable
private fun StaffShiftTab(runner: GameRunner, state: GameState) {
    CardBox {
        Text(
            "排班決定誰會在什麼時間出現；未排上的人當天不會工作。",
            color = Color(0xFF8494b8),
            fontSize = 12.sp
        )
        Spacer(Modifier.height(6.dp))
        Act("一鍵排班", compact = false) { runner.dispatch(GameAction.AutoShift) }
    }
    for (s in state.staff) {
        CardBox(s.name) {
            Stepper(
                "上班",
                hhmm(s.shift.start),
                onMinus = { runner.dispatch(GameAction.SetShift(s.uid, s.shift.start - 60, s.shift.end)) },
                onPlus = { runner.dispatch(GameAction.SetShift(s.uid, s.shift.start + 60, s.shift.end)) }
            )
            Stepper(
                "下班",
                hhmm(s.shift.end),
                onMinus = { runner.dispatch(GameAction.SetShift(s.uid, s.shift.start, s.shift.end - 60)) },
                onPlus = { runner.dispatch(GameAction.SetShift(s.uid, s.shift.start, s.shift.end + 60)) }
            )
            Spacer(Modifier.height(4.dp))
            Text("工作項目", color = Color(0xFF8494b8), fontSize = 12.sp)
            val d = s.duties
            ToggleRow("帶位", d.escort) { runner.dispatch(GameAction.SetDuty(s.uid, "escort", !d.escort)) }
            ToggleRow("送餐", d.serve) { runner.dispatch(GameAction.SetDuty(s.uid, "serve", !d.serve)) }
            ToggleRow("點餐", d.order) { runner.dispatch(GameAction.SetDuty(s.uid, "order", !d.order)) }
            ToggleRow("收桌", d.bus) { runner.dispatch(GameAction.SetDuty(s.uid, "bus", !d.bus)) }
            ToggleRow("清潔地板", d.cleanFloor) { runner.dispatch(GameAction.SetDuty(s.uid, "cleanFloor", !d.cleanFloor)) }
            ToggleRow("清潔廁所", d.cleanRestroom) { runner.dispatch(GameAction.SetDuty(s.uid, "cleanRestroom", !d.cleanRestroom)) }
            ToggleRow("收銀", d.cashier) { runner.dispatch(GameAction.SetDuty(s.uid, "cashier", !d.cashier)) }
        }
    }
}

/* -------------------------------------------------------------- 裝潢設備 */

private val BUILD_CATEGORIES = listOf(
    "table" to "桌椅",
    "chair" to "椅子",
    "counter" to "櫃台",
    "kitchen" to "廚具",
    "equipment" to "設備",
    "restroom" to "衛浴",
    "decor" to "裝飾",
    "lighting" to "燈具"
)

@Composable
private fun BuildBuyTab(runner: GameRunner, state: GameState) {
    CardBox {
        KV("現金", "NT$ ${moneyD(state.cash)}")
        Text(
            "點「擺放」會自動找一個可以放的位置；桌椅會自動配上椅子。",
            color = Color(0xFF8494b8),
            fontSize = 12.sp
        )
    }
    for ((cat, label) in BUILD_CATEGORIES) {
        val list = FURNITURE.filter { it.category == cat }
        if (list.isEmpty()) continue
        CardBox(label) {
            for (f in list) {
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(f.name, color = Color.White, fontSize = 13.sp)
                        Text(
                            "NT$ ${money(f.price)} · 裝飾 +${f.decorScore}" +
                                if (f.seats > 0) " · ${f.seats} 座" else "",
                            color = Color(0xFF8494b8),
                            fontSize = 11.sp
                        )
                    }
                    Act("擺放", enabled = state.cash >= f.price) {
                        runner.dispatch(GameAction.PlaceFurniture(f.id))
                    }
                }
            }
        }
    }
}

@Composable
private fun BuildItemsTab(runner: GameRunner, state: GameState) {
    val items = state.layout.items
    CardBox {
        KV("物件數", "${items.size} 件")
    }
    if (items.isEmpty()) {
        CardBox { Text("場上沒有傢俱。", color = Color(0xFF8494b8), fontSize = 12.sp) }
    }
    for (item in items) {
        val def = FURNITURE.firstOrNull { it.id == item.typeId }
        CardBox(if (item.broken) "${def?.name ?: item.typeId}（故障）" else def?.name ?: item.typeId) {
            KV("位置", "(${item.x}, ${item.y})")
            KV("耐久", "${item.durability}%", if (item.durability < 40) Color(0xFFFF8A80) else Color.White)
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Act("旋轉") { runner.dispatch(GameAction.RotateFurniture(item.uid)) }
                if (item.broken || item.durability < 100) {
                    Act("維修") { runner.dispatch(GameAction.Repair(uid = item.uid)) }
                }
                Act("拆除") { runner.dispatch(GameAction.RemoveFurniture(item.uid)) }
            }
        }
    }
}

@Composable
private fun BuildMaintTab(runner: GameRunner, state: GameState) {
    val dirt = state.sim.dirt
    val broken = state.sim.equipBroken
    CardBox("清潔") {
        KV("地板髒污", String.format(Locale.US, "%.0f%%", (dirt.floor * 100).coerceIn(0.0, 100.0)),
            if (dirt.floor > 0.6) Color(0xFFFF8A80) else Color.White)
        KV("廁所髒污", String.format(Locale.US, "%.0f%%", (dirt.restroom * 100).coerceIn(0.0, 100.0)),
            if (dirt.restroom > 0.6) Color(0xFFFF8A80) else Color.White)
        Spacer(Modifier.height(4.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Act("清潔店內", compact = false) { runner.dispatch(GameAction.Clean("floor")) }
            Act("清潔廁所", compact = false) { runner.dispatch(GameAction.Clean("restroom")) }
        }
    }
    CardBox("設備故障") {
        ToggleRow("空調", !broken.ac) { runner.dispatch(GameAction.Repair(target = "ac")) }
        ToggleRow("爐具", !broken.stove) { runner.dispatch(GameAction.Repair(target = "stove")) }
        ToggleRow("冰箱", !broken.fridge) { runner.dispatch(GameAction.Repair(target = "fridge")) }
        Spacer(Modifier.height(4.dp))
        Text("關閉＝已故障；點一下會花錢修好。", color = Color(0xFF8494b8), fontSize = 11.sp)
    }
    CardBox("全面檢修") {
        Text(
            "傢俱的耐久會隨著營業下降，故障的傢俱要先修好才能繼續用。",
            color = Color(0xFF8494b8),
            fontSize = 12.sp
        )
        Spacer(Modifier.height(6.dp))
        Act("逐一維修故障傢俱", compact = false) {
            for (item in state.layout.items) {
                if (item.broken) runner.dispatch(GameAction.Repair(uid = item.uid))
            }
        }
    }
}

@Composable
private fun BuildKitchenTab(runner: GameRunner, state: GameState) {
    val k = state.kitchen
    CardBox("廚房設備") {
        Stepper("爐具 Lv.${k.stove}", "等級 ${k.stove} / ${B.KITCHEN_MAX_LEVEL}",
            onMinus = {}, onPlus = { runner.dispatch(GameAction.UpgradeKitchen("stove")) },
            enabled = k.stove < B.KITCHEN_MAX_LEVEL)
        Stepper("冰箱 Lv.${k.fridge}", "等級 ${k.fridge} / ${B.KITCHEN_MAX_LEVEL}",
            onMinus = {}, onPlus = { runner.dispatch(GameAction.UpgradeKitchen("fridge")) },
            enabled = k.fridge < B.KITCHEN_MAX_LEVEL)
        Stepper("備餐 Lv.${k.prep}", "等級 ${k.prep} / ${B.KITCHEN_MAX_LEVEL}",
            onMinus = {}, onPlus = { runner.dispatch(GameAction.UpgradeKitchen("prep")) },
            enabled = k.prep < B.KITCHEN_MAX_LEVEL)
        Spacer(Modifier.height(6.dp))
        Text("按「＋」直接升級，費用會自動扣除。", color = Color(0xFF8494b8), fontSize = 12.sp)
    }
    CardBox("效果") {
        KV("出餐速度", "爐具等級越高越快")
        KV("保鮮", "冰箱等級越高，庫存越不容易失鮮")
        KV("備餐量", "備餐等級越高，同時可備的鍋數越多")
    }
}

/* ---------------------------------------------------------------- 報表 */

@Composable
private fun ReportTodayTab(runner: GameRunner, state: GameState) {
    val t = state.stats.today
    CardBox("第 ${state.day} 天 · 今日營運") {
        KV("營業額", "NT$ ${moneyD(t.revenue)}")
        KV("小費", "NT$ ${moneyD(t.tips)}")
        KV("支出", "NT$ ${moneyD(t.spend)}", Color(0xFFFF8A80))
        KV("淨利", "NT$ ${moneyD(t.revenue + t.tips - t.spend)}",
            if (t.revenue + t.tips - t.spend >= 0) Color(0xFF66BB6A) else Color(0xFFFF8A80))
        Spacer(Modifier.height(4.dp))
        KV("來客", "${t.guests} 人")
        KV("服務完成", "${t.served} 人")
        KV("生氣離開", "${t.angry} 人", if (t.angry > 0) Color(0xFFFF8A80) else Color.White)
        KV("平均等待", if (t.waitCount > 0) "${t.waitSum / t.waitCount} 分" else "—")
        KV("平均心情", if (t.moodCount > 0) "${(t.moodSum / t.moodCount).toInt()}" else "—")
        KV("天氣", com.dreamrestaurant.core.B.WEATHER_NAME[t.weather] ?: t.weather)
    }
    if (t.complaints.isNotEmpty()) {
        CardBox("客訴") {
            for ((reason, n) in t.complaints) {
                KV(reason, "$n 次", Color(0xFFFF8A80))
            }
        }
    }
}

@Composable
private fun ReportHistoryTab(runner: GameRunner, state: GameState) {
    val history = state.stats.history
    CardBox {
        KV("營業天數", "${history.size} 天")
        KV("週結算", "${state.stats.weekly.size} 次")
    }
    if (history.isEmpty()) {
        CardBox { Text("還沒有完成的營業日。", color = Color(0xFF8494b8), fontSize = 12.sp) }
    }
    for (r in history.takeLast(14).reversed()) {
        CardBox("第 ${r.day} 天 · ${getLocation(r.locationId)?.name ?: r.locationId}") {
            KV("營業額", "NT$ ${money(r.revenue)}")
            KV("淨利", "NT$ ${money(r.profit)}", if (r.profit >= 0) Color(0xFF66BB6A) else Color(0xFFFF8A80))
            KV("來客 / 服務 / 生氣", "${r.guests} / ${r.served} / ${r.angry}")
            KV("評價", "社區 ${r.repCommunity.toInt()} ｜ 區外 ${r.repOutside.toInt()}")
            KV("星級", "${r.stars} 星" + (r.magazineRank?.let { " ｜ 雜誌第 $it 名" } ?: ""))
        }
    }
}

@Composable
private fun ReportMagazineTab(runner: GameRunner, state: GameState) {
    val mag = state.stats.magazine
    CardBox("雜誌統計") {
        KV("目前總排名", mag.lastTotalRank?.let { "第 $it 名" } ?: "—")
        KV("歷史最佳", mag.bestTotalRank?.let { "第 $it 名" } ?: "—")
        KV("週冠軍次數", "${mag.firstPlaceWeeks}")
        KV("上次结算", "第 ${mag.lastSettleDay} 天")
    }
    if (mag.rank.isEmpty()) {
        CardBox { Text("週結算後才會出現排行榜。", color = Color(0xFF8494b8), fontSize = 12.sp) }
    }
    for ((key, board) in mag.rank) {
        CardBox("${board.category.ifEmpty { key }}　第 ${board.rank} 名　分數 ${board.score}") {
            for (e in board.topList.take(5)) {
                KV("${e.rank}. ${e.name}", "${e.score}",
                    if (e.me) Color(0xFF64B5F6) else Color.White)
            }
        }
    }
}

@Composable
private fun ReportRatingTab(runner: GameRunner, state: GameState) {
    CardBox("評價") {
        KV("星級", "${state.stars} 星")
        KV("名氣", String.format(Locale.US, "%.1f", state.fame))
        KV("社區評價", String.format(Locale.US, "%.0f", state.reputation.community))
        KV("區外評價", String.format(Locale.US, "%.0f", state.reputation.outside))
    }
    CardBox("分項") {
        for ((k, v) in state.stats.ratingsScore) {
            val label = when (k) {
                "taste" -> "口味"
                "service" -> "服務"
                "decor" -> "裝潢"
                "price" -> "價格"
                "popularity" -> "人氣"
                else -> k
            }
            KV(label, String.format(Locale.US, "%.1f", v))
        }
    }
}

/* ---------------------------------------------------------------- 環境 */

@Composable
private fun EnvHoursTab(runner: GameRunner, state: GameState) {
    val s = state.settings
    CardBox("營業時間") {
        Stepper("開店", hhmm(s.openMinute),
            onMinus = { runner.dispatch(GameAction.SetHours(openMinute = s.openMinute - 30)) },
            onPlus = { runner.dispatch(GameAction.SetHours(openMinute = s.openMinute + 30)) })
        Stepper("打烊", hhmm(s.closeMinute),
            onMinus = { runner.dispatch(GameAction.SetHours(closeMinute = s.closeMinute - 30)) },
            onPlus = { runner.dispatch(GameAction.SetHours(closeMinute = s.closeMinute + 30)) })
    }
    CardBox("每週營業日") {
        val names = listOf("一", "二", "三", "四", "五", "六", "日")
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            names.forEachIndexed { i, n ->
                val on = s.openDays[i]
                SmallChip(n, selected = on) { runner.dispatch(GameAction.ToggleDay(i)) }
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            "關掉的那天員工不會上班，也不能開始營業。",
            color = Color(0xFF8494b8),
            fontSize = 12.sp
        )
    }
    CardBox("今日操作") {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Act("招攬客人", compact = false) { runner.dispatch(GameAction.Lure()) }
            Act("今日不營業", compact = false) { runner.dispatch(GameAction.CannotOpenToday) }
        }
    }
    val loc = getLocation(state.locationId)
    if (loc != null) {
        CardBox("地點") {
            KV("名稱", loc.name)
            KV("租金", "NT$ ${money(loc.rentPerDay)} / 天")
            KV("搬遷費", "NT$ ${money(loc.moveCost)}")
            Spacer(Modifier.height(4.dp))
            Act("搬到這裡", enabled = state.phase == "build" || state.phase == "closed") {
                runner.dispatch(GameAction.MoveLocation(loc.id))
            }
        }
    }
}

@Composable
private fun EnvAcTab(runner: GameRunner, state: GameState) {
    val s = state.settings
    CardBox("空調") {
        Stepper("溫度", "${s.acTemp} °C",
            onMinus = { runner.dispatch(GameAction.SetAc(s.acTemp - 1)) },
            onPlus = { runner.dispatch(GameAction.SetAc(s.acTemp + 1)) })
        Spacer(Modifier.height(4.dp))
        Text(
            "天氣越極端，客人對溫度越敏感；空調壞掉會大幅扣分。",
            color = Color(0xFF8494b8),
            fontSize = 12.sp
        )
    }
    val broken = state.sim.equipBroken
    CardBox("設備狀況") {
        ToggleRow("空調", !broken.ac) { runner.dispatch(GameAction.Repair(target = "ac")) }
        ToggleRow("爐具", !broken.stove) { runner.dispatch(GameAction.Repair(target = "stove")) }
        ToggleRow("冰箱", !broken.fridge) { runner.dispatch(GameAction.Repair(target = "fridge")) }
    }
}

@Composable
private fun EnvMusicTab(runner: GameRunner, state: GameState) {
    val current = state.settings.music
    CardBox("背景音樂") {
        val list = listOf(
            "lazy" to "悠閒", "tropical" to "熱帶", "classic1" to "古典一",
            "classic2" to "古典二", "pop" to "流行", "off" to "靜音"
        )
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
            for ((id, label) in list) {
                SmallChip(label, selected = current == id) {
                    runner.dispatch(GameAction.SetMusic(id))
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            "曲風會影響客人類型的喜好（熱帶／流行對年輕客群較有吸引力）。",
            color = Color(0xFF8494b8),
            fontSize = 12.sp
        )
    }
    CardBox("音效") {
        ToggleRow("音效", runner.soundOn) { runner.toggleSound() }
    }
}

@Composable
private fun EnvFxTab(runner: GameRunner, state: GameState) {
    val fx = state.settings.fx
    CardBox("畫面效果") {
        ToggleRow("光池（燈光落地光斑）", fx.pools) { runner.dispatch(GameAction.SetFx("pools", !fx.pools)) }
        ToggleRow("陰影", fx.shadows) { runner.dispatch(GameAction.SetFx("shadows", !fx.shadows)) }
        ToggleRow("環境遮蔽", fx.ao) { runner.dispatch(GameAction.SetFx("ao", !fx.ao)) }
        ToggleRow("暗角", fx.vignette) { runner.dispatch(GameAction.SetFx("vignette", !fx.vignette)) }
        ToggleRow("店外遮罩", fx.outsideShade) { runner.dispatch(GameAction.SetFx("outsideShade", !fx.outsideShade)) }
        ToggleRow("光柱", fx.shafts) { runner.dispatch(GameAction.SetFx("shafts", !fx.shafts)) }
        Spacer(Modifier.height(6.dp))
        Text(
            "部分效果會依硬體效能自動調整；時段色調與天氣是常駐的。",
            color = Color(0xFF8494b8),
            fontSize = 12.sp
        )
    }
}

private val WALL_PRESETS = listOf(
    "#c9a26b" to "原木", "#e8e3d6" to "白牆", "#9fb3c8" to "灰藍",
    "#d98f8f" to "藕粉", "#7f9c7a" to "薄荷", "#4a4f63" to "深灰"
)

private val FLOOR_PRESETS = listOf(
    "#8c6a44" to "原木", "#b9a48a" to "淺木", "#8d93a1" to "灰磚",
    "#6f8f7a" to "綠磚", "#3f4756" to "深磚", "#a5793f" to "陶磚"
)

@Composable
private fun EnvColorTab(runner: GameRunner, state: GameState) {
    CardBox("牆面") {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
            for ((hex, label) in WALL_PRESETS) {
                SmallChip(label, selected = state.settings.wallColor.equals(hex, ignoreCase = true)) {
                    runner.dispatch(GameAction.SetSetting("wallColor", hex))
                }
            }
        }
    }
    CardBox("地板") {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
            for ((hex, label) in FLOOR_PRESETS) {
                SmallChip(label, selected = state.settings.floorColor.equals(hex, ignoreCase = true)) {
                    runner.dispatch(GameAction.SetSetting("floorColor", hex))
                }
            }
        }
    }
    CardBox {
        KV("目前牆面", state.settings.wallColor)
        KV("目前地板", state.settings.floorColor)
        Text(
            "改色會立刻重繪地面與牆面，不影響模擬數據。",
            color = Color(0xFF8494b8),
            fontSize = 12.sp
        )
    }
}

/* ---------------------------------------------------------------- 系統 */

@Composable
private fun SystemSaveTab(runner: GameRunner, frame: Long) {
    val slots = remember(runner.openPanel, frame / 20) { runner.saveSlots() }
    CardBox("手動存檔") {
        Text(
            "存檔只存在這台裝置上；卸載 App 會一併刪除。",
            color = Color(0xFF8494b8),
            fontSize = 12.sp
        )
    }
    for (slot in slots) {
        if (slot.slot == "auto") continue
        CardBox("槽位 ${slot.slot}") {
            if (slot.savedAt == null) {
                Text("（空）", color = Color(0xFF8494b8), fontSize = 12.sp)
            } else {
                KV("時間", slot.savedAt ?: "—")
                KV("天數", slot.day?.let { "第 $it 天" } ?: "—")
                KV("現金", slot.cash?.let { "NT$ ${moneyD(it)}" } ?: "—")
                KV("星級", slot.stars?.let { "$it 星" } ?: "—")
            }
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Act("存檔") { runner.dispatch(GameAction.SaveGame(slot.slot)) }
                Act("讀檔", enabled = slot.savedAt != null) { runner.dispatch(GameAction.LoadGame(slot.slot)) }
            }
        }
    }
    slots.firstOrNull { it.slot == "auto" }?.let { auto ->
        CardBox("自動存檔") {
            KV("時間", auto.savedAt ?: "（尚無）")
            KV("天數", auto.day?.let { "第 $it 天" } ?: "—")
            Spacer(Modifier.height(4.dp))
            Act("讀檔", enabled = auto.savedAt != null) {
                runner.dispatch(GameAction.LoadGame("auto"))
            }
        }
    }
    CardBox("重新開始") {
        Act("開新遊戲（隨機種子）", compact = false) {
            runner.dispatch(GameAction.NewGame())
        }
    }
}

@Composable
private fun SystemStatsTab(runner: GameRunner, state: GameState) {
    CardBox("遊戲進度") {
        KV("天數", "第 ${state.day} 天")
        KV("階段", when (state.phase) {
            "build" -> "準備中"; "open" -> "營業中"; "closing" -> "打烊中"
            "closed" -> "已打烊"; "settle" -> "結算中"; "gameover" -> "破產"
            else -> state.phase
        })
        KV("現金", "NT$ ${moneyD(state.cash)}")
        KV("星級", "${state.stars} 星")
        KV("名氣", String.format(Locale.US, "%.1f", state.fame))
        KV("菜單 / 上限", "${state.menu.size} / ${state.menuLimit}")
        KV("員工", "${state.staff.size} 人")
        KV("傢俱", "${state.layout.items.size} 件")
    }
    CardBox("位置") {
        val loc = getLocation(state.locationId)
        KV("地點", loc?.name ?: state.locationId)
        KV("城市", loc?.city ?: "—")
    }
    CardBox("紀錄") {
        KV("營業日", "${state.stats.history.size}")
        KV("週結算", "${state.stats.weekly.size}")
        KV("日誌", "${state.log.size} 則")
    }
}

@Composable
private fun SystemHelpTab() {
    CardBox("怎麼玩") {
        Text(
            "1. 在「菜單進貨」加入菜單並補足庫存。\n" +
                "2. 在「員工」確認至少一位廚師與一位服務生。\n" +
                "3. 在「裝潢設備」擺放桌椅，座位數決定能接待多少客人。\n" +
                "4. 按右下角「開始營業」，時間會自動推進。\n" +
                "5. 每天打烊後看「報表」，調整價格與排班。",
            color = Color(0xFFc8d4ee),
            fontSize = 13.sp,
            lineHeight = 20.sp
        )
    }
    CardBox("操作") {
        KV("速度", "暫停 / 1x / 2x / 4x")
        KV("快轉", "×1 / ×5 / ×20 是純介面倍率")
        KV("功能列", "上方一排可隨時開啟各面板")
        KV("音效", "右下角「音效」可靜音")
    }
    CardBox("資料") {
        Text(
            "這款是網頁版 Dream Restaurant 的 Android 移植：模擬數值與網頁版逐欄一致，畫面與操作依手機重新設計。",
            color = Color(0xFF8494b8),
            fontSize = 12.sp
        )
    }
}
