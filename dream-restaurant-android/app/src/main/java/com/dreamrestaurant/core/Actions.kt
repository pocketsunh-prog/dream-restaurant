package com.dreamrestaurant.core

import com.dreamrestaurant.data.DISHES
import com.dreamrestaurant.data.dishesForStars
import com.dreamrestaurant.data.furnitureById
import com.dreamrestaurant.data.getDish
import com.dreamrestaurant.data.getLocation
import com.dreamrestaurant.data.locationsForStars
import com.dreamrestaurant.data.staffById
import com.dreamrestaurant.sim.Item
import com.dreamrestaurant.sim.Layout
import com.dreamrestaurant.sim.PlaceResult
import com.dreamrestaurant.sim.absMinute
import com.dreamrestaurant.sim.autoPlaceChairs
import com.dreamrestaurant.sim.beginDay
import com.dreamrestaurant.sim.buyCost
import com.dreamrestaurant.sim.canPlace
import com.dreamrestaurant.sim.clearPathCache
import com.dreamrestaurant.sim.clickLure
import com.dreamrestaurant.sim.clamp
import com.dreamrestaurant.sim.decorScore
import com.dreamrestaurant.sim.defaultLayout
import com.dreamrestaurant.sim.findAutoPlace
import com.dreamrestaurant.sim.findItem
import com.dreamrestaurant.sim.layoutValue
import com.dreamrestaurant.sim.nextDay
import com.dreamrestaurant.sim.rebuildTables
import com.dreamrestaurant.sim.requestClose
import com.dreamrestaurant.sim.seatCount
import com.dreamrestaurant.sim.setTile
import com.dreamrestaurant.sim.startBusiness
import com.dreamrestaurant.sim.syncFootprints
import com.dreamrestaurant.sim.tileAt
import com.dreamrestaurant.sim.unitCost
import com.dreamrestaurant.core.round

/** reducer 的回傳值：ok + 可選訊息，或 error */
class ActionResult(val ok: Boolean, val info: String? = null, val error: String? = null) {
    companion object {
        fun ok(info: String? = null) = ActionResult(true, info)
        fun fail(error: String) = ActionResult(false, null, error)
    }
}

private fun ok(info: String? = null) = ActionResult.ok(info)
private fun fail(error: String) = ActionResult.fail(error)

/** MENU_UPDATE 的補丁欄位（未給的欄位不動） */
class MenuPatch(
    val price: Int? = null,
    val grade: Int? = null,
    val taste: Int? = null,
    val portion: Int? = null,
    val cookTime: Int? = null
)

/**
 * 一件傢俱的擁有物：自動配來的椅子。
 * 椅子上有三個欄位可以證明歸屬 —— chairFor（原本就有）、tableUid（繪圖層用的）、
 * autoChair 旗標；只要 owner uid 對得上就算，不靠座標猜。
 */
fun ownedItemUids(state: GameState, ownerUid: String): List<String> {
    val out = mutableListOf<String>()
    for (it in state.layout.items) {
        if (it.uid == ownerUid) continue
        val owner = it.tableUid ?: it.chairFor
        if (it.autoChair && owner == ownerUid) out.add(it.uid)
    }
    return out
}

/**
 * 刪掉一件傢俱（桌子連同自己的椅子一起走）。回傳實際刪掉的 uid 陣列。
 * 桌椅是一組：桌子被拆掉，它的椅子就不該留在場上當孤兒。
 */
fun removeItemsByIds(state: GameState, uids: List<String>): List<String> {
    val drop = linkedSetOf<String>()
    for (uid in uids) {
        val item = findItem(state.layout, uid) ?: continue
        drop.add(uid)
        for (cuid in item.chairUids ?: emptyList()) drop.add(cuid)
        for (cuid in ownedItemUids(state, uid)) drop.add(cuid)
    }
    if (drop.isEmpty()) return emptyList()
    for (it in state.layout.items) {
        val cu = it.chairUids
        if (cu != null && cu.any { it in drop }) {
            it.chairUids = cu.filterNot { it in drop }.toMutableList()
        }
    }
    state.layout.items = state.layout.items.filter { it.uid !in drop }.toMutableList()
    state.sim.tables = state.sim.tables.filter { it.uid !in drop }.toMutableList()
    return drop.toList()
}

private inline fun withLayoutChange(state: GameState, fn: () -> ActionResult): ActionResult {
    val res = fn()
    // 換成新的 layout 物件：繪圖層以「物件參照 + rev」判斷快取是否失效，
    // 若只是就地改 items，命中判定與繪製快取會停留在舊位置（按了傢俱卻點不到）。
    state.layout = state.layout.copyWithRev(state.layout.rev + 1)
    clearPathCache()
    rebuildTables(state)
    return res
}

private fun menuEntryOf(state: GameState, dishId: String): com.dreamrestaurant.core.MenuEntry? =
    state.menu.firstOrNull { it.dishId == dishId }

fun ingredientUnitCost(state: GameState, dishId: String): Double {
    val entry = menuEntryOf(state, dishId) ?: return 0.0
    return unitCost(entry)
}

object Actions {

    /* ---------------------------------------------------------- 時間控制 */

    fun setSpeed(state: GameState, value: Int): ActionResult {
        if (value !in B.SPEEDS) return fail("無效的速度")
        state.speed = value
        return ok()
    }

    fun setHours(state: GameState, openMinute: Int? = null, closeMinute: Int? = null): ActionResult {
        val open = clamp(round((openMinute ?: state.settings.openMinute).toDouble()).toInt(), 0, 1439)
        val close = clamp(round((closeMinute ?: state.settings.closeMinute).toDouble()).toInt(), 0, 1439)
        if (close - open < 120) return fail("營業時間至少要 2 小時")
        state.settings.openMinute = open
        state.settings.closeMinute = close
        return ok()
    }

    fun toggleDay(state: GameState, index: Int): ActionResult {
        val i = clamp(round(index.toDouble()).toInt(), 0, 6)
        state.settings.openDays[i] = !state.settings.openDays[i]
        if (state.settings.openDays.none { it }) {
            state.settings.openDays[i] = true
            return fail("至少要有一天營業")
        }
        return ok()
    }

    fun setAc(state: GameState, temp: Int): ActionResult {
        state.settings.acTemp = clamp(round(temp.toDouble()).toInt(), 16, 30)
        return ok()
    }

    fun setFx(state: GameState, key: String, on: Boolean): ActionResult {
        val keys = listOf("pools", "shadows", "ao", "vignette", "outsideShade", "shafts")
        if (key !in keys) return fail("沒有這項畫面特效")
        val fx = state.settings.fx
        when (key) {
            "pools" -> fx.pools = on
            "shadows" -> fx.shadows = on
            "ao" -> fx.ao = on
            "vignette" -> fx.vignette = on
            "outsideShade" -> fx.outsideShade = on
            "shafts" -> fx.shafts = on
        }
        return ok()
    }

    /** 通用設定寫入 */
    fun setSetting(state: GameState, key: String, value: Any?): ActionResult {
        when (key) {
            "openMinute" -> state.settings.openMinute = clamp(round((value as? Number ?: 0).toDouble()).toInt(), 0, 1439)
            "closeMinute" -> state.settings.closeMinute = clamp(round((value as? Number ?: 0).toDouble()).toInt(), 0, 1439)
            "acTemp" -> state.settings.acTemp = clamp(round((value as? Number ?: 0).toDouble()).toInt(), 16, 30)
            "music" -> state.settings.music = value?.toString() ?: "lazy"
            "wallColor" -> state.settings.wallColor = value?.toString() ?: state.settings.wallColor
            "floorColor" -> state.settings.floorColor = value?.toString() ?: state.settings.floorColor
            "wallMat" -> state.settings.wallMat = value?.toString()
            "floorMat" -> state.settings.floorMat = value?.toString()
            else -> return fail("沒有這項設定")
        }
        return ok()
    }

    fun setMusic(state: GameState, id: String): ActionResult {
        if (!B.MUSIC_NAME.containsKey(id)) return fail("沒有這個曲風")
        state.settings.music = id
        return ok()
    }

    /* -------------------------------------------------------------- 菜單 */

    fun menuAdd(state: GameState, dishId: String): ActionResult {
        val def = getDish(dishId) ?: return fail("沒有這道料理")
        if (def.unlockStars > state.stars) return fail("${def.name} 要 ${def.unlockStars} 星才會解鎖")
        // 原作：隱藏料理要拿到年度大獎才會解鎖
        if (def.secret && !state.flags.secretUnlocked) {
            return fail("${def.name} 是隱藏料理，要拿到年度大獎才會解鎖")
        }
        if (menuEntryOf(state, dishId) != null) return fail("這道菜已經在菜單上了")
        val limit = menuLimitFor(state.stars)
        if (state.menu.size >= limit) return fail("目前星級最多只能上架 $limit 道菜")
        state.menu.add(
            com.dreamrestaurant.core.MenuEntry(
                dishId = def.id,
                price = if (def.expectedPrice > 0) def.expectedPrice else round((if (def.baseCost > 0) def.baseCost else 20) * 7.0).toInt(),
                grade = def.gradeDefault,
                taste = def.tasteDefault,
                portion = def.portionDefault,
                cookTime = def.cookTimeDefault,
                active = true,
                sold = 0
            )
        )
        if (!state.stock.containsKey(def.id)) state.stock[def.id] = 0
        return ok("已上架 ${def.name}")
    }

    fun menuRemove(state: GameState, dishId: String): ActionResult {
        val entry = menuEntryOf(state, dishId) ?: return fail("這道菜不在菜單上")
        state.menu = state.menu.filter { it.dishId != entry.dishId }.toMutableList()
        return ok("已移除")
    }

    fun menuUpdate(state: GameState, dishId: String, patch: MenuPatch): ActionResult {
        val entry = menuEntryOf(state, dishId) ?: return fail("這道菜不在菜單上")
        patch.price?.let { entry.price = clamp(round(it.toDouble()).toInt(), 1, 9999) }
        patch.grade?.let { entry.grade = clamp(round(it.toDouble()).toInt(), 0, 100) }
        patch.taste?.let { entry.taste = clamp(round(it.toDouble()).toInt(), 0, 100) }
        patch.portion?.let { entry.portion = clamp(round(it.toDouble()).toInt(), 0, 100) }
        patch.cookTime?.let { entry.cookTime = clamp(round(it.toDouble()).toInt(), 1, 60) }
        return ok()
    }

    fun menuToggle(state: GameState, dishId: String): ActionResult {
        val entry = menuEntryOf(state, dishId) ?: return fail("這道菜不在菜單上")
        entry.active = !entry.active
        return if (entry.active) ok("恢復供應") else ok("暫停供應")
    }

    /* -------------------------------------------------------------- 進貨 */

    fun buyStock(state: GameState, dishId: String, servings: Int = 10): ActionResult {
        val entry = menuEntryOf(state, dishId) ?: return fail("先上架這道菜才能進貨")
        val n = if (servings > 0) round(servings.toDouble()).toInt() else 1
        val cost = buyCost(entry, n, state.sim.supplierPriceMul)
        if (state.cash < cost) return fail("現金不足（需要 NT$ ${formatMoney(cost)}）")
        state.cash -= cost
        state.stats.today.inventory += cost
        state.stats.today.spend += cost
        state.suppliers.add(
            com.dreamrestaurant.core.Supplier(
                entry.dishId, n, absMinute(state) + B.DELIVERY_MINUTES, cost
            )
        )
        val name = getDish(entry.dishId)?.name ?: entry.dishId
        return ok("$name 進貨 $n 份，${B.DELIVERY_MINUTES} 分鐘後到貨")
    }

    /* -------------------------------------------------------------- 員工 */

    fun hire(state: GameState, candidateId: String): ActionResult {
        val cand = state.candidates.firstOrNull { it.candidateId == candidateId }
            ?: return fail("找不到這位應徵者")
        val person = staffById(cand.staffId) ?: return fail("找不到這位應徵者")
        val wage = if (cand.askWage != 0.0) cand.askWage else person.wage.toDouble()
        val fee = round(wage * 2).toInt()
        if (state.cash < fee) return fail("現金不足，付不出簽約金")
        state.cash -= fee
        state.stats.today.spend += fee
        state.staff.add(makeStaffEntry(state, person, round(wage).toInt()))
        state.candidates = state.candidates.filter { it.candidateId != cand.candidateId }.toMutableList()
        val roleText = if (person.role == "chef") "廚師" else "服務生"
        pushLog(state, "雇用 ${person.name}（$roleText），時薪 $wage", "good")
        return ok("已雇用 ${person.name}")
    }

    fun fire(state: GameState, uid: String): ActionResult {
        val st = state.staff.firstOrNull { it.uid == uid } ?: return fail("找不到這位員工")
        if (st.role == "chef" && state.staff.count { it.role == "chef" } <= 1) {
            return fail("至少要留一位廚師")
        }
        val severance = round(st.wage * B.SEVERANCE_HOURS.toDouble()).toInt()
        state.cash -= severance
        state.stats.today.spend += severance
        state.staff = state.staff.filter { it.uid != uid }.toMutableList()
        val t = st.task
        if (t != null) state.sim.tasks = state.sim.tasks.filter { it.id != t }.toMutableList()
        pushLog(state, "解僱 ${st.name}，支付資遣費 NT$ $severance", "warn")
        return ok("已解僱 ${st.name}")
    }

    fun setWage(state: GameState, uid: String, wage: Int): ActionResult {
        val st = state.staff.firstOrNull { it.uid == uid } ?: return fail("找不到這位員工")
        st.wage = clamp(round(wage.toDouble()).toInt(), B.MIN_WAGE, B.MAX_WAGE)
        val base = staffById(st.staffId)?.wage ?: 2
        st.mood = clamp(st.mood + (if (st.wage >= base) 4.0 else -6.0), 0.0, 100.0)
        return ok("時薪調整為 ${st.wage} 元")
    }

    fun setShift(state: GameState, uid: String, start: Int, end: Int): ActionResult {
        val st = state.staff.firstOrNull { it.uid == uid } ?: return fail("找不到這位員工")
        val s = clamp(round(start.toDouble()).toInt(), 0, 1439)
        val e = clamp(round(end.toDouble()).toInt(), 0, 1439)
        if (s == e) return fail("上下班時間不能相同")
        st.shift = com.dreamrestaurant.core.Shift(s, e)
        return ok()
    }

    fun setDuty(state: GameState, uid: String, duty: String, on: Boolean): ActionResult {
        val st = state.staff.firstOrNull { it.uid == uid } ?: return fail("找不到這位員工")
        val keys = listOf("escort", "serve", "order", "bus", "cleanRestroom", "cleanFloor", "cashier")
        if (duty !in keys) return fail("沒有這項職務")
        when (duty) {
            "escort" -> st.duties.escort = on
            "serve" -> st.duties.serve = on
            "order" -> st.duties.order = on
            "bus" -> st.duties.bus = on
            "cleanRestroom" -> st.duties.cleanRestroom = on
            "cleanFloor" -> st.duties.cleanFloor = on
            "cashier" -> st.duties.cashier = on
        }
        return ok()
    }

    /* ------------------------------------------------------------ 裝潢 */

    fun placeFurniture(state: GameState, typeId: String, x: Int? = null, y: Int? = null, rot: Int = 0): ActionResult {
        val def = furnitureById(typeId) ?: return fail("沒有這件傢俱")
        var px = round((x ?: -1).toDouble()).toInt()
        var py = round((y ?: -1).toDouble()).toInt()
        if (px < 0 || py < 0) {
            val spot = findAutoPlace(state.layout, def.id) ?: return fail("找不到適合的位置")
            px = round(spot.x).toInt(); py = round(spot.y).toInt()
        }
        if (state.cash < def.price) return fail("現金不足（${def.name} 要 NT$ ${formatMoney(def.price)}）")
        val check = canPlace(state.layout, def.id, px, py)
        if (!check.ok) return fail(check.error ?: "無法放置")
        state.cash -= def.price
        state.stats.today.spend += def.price
        state.uidSeq = if (state.uidSeq >= 1) state.uidSeq + 1 else 2
        val uid = "f${state.uidSeq}"
        val item = Item(uid, def.id, px, py, def.w, def.h, rot, 100, false)
        state.layout.items.add(item)
        var chairMsg = ""
        if (def.category == "table") {
            val chairUids = autoPlaceChairs(state, item) { s -> nextUid(s as GameState) }
            item.chairUids = chairUids.toMutableList()
            if (chairUids.isNotEmpty()) chairMsg = "（自動配 ${chairUids.size} 張椅子）"
        }
        return withLayoutChange(state) { ok("已購入 ${def.name}$chairMsg") }
    }

    fun moveFurniture(state: GameState, uid: String, x: Int, y: Int): ActionResult {
        val item = findItem(state.layout, uid) ?: return fail("找不到這件傢俱")
        val nx = round(x.toDouble()).toInt()
        val ny = round(y.toDouble()).toInt()
        val check = canPlace(state.layout, item.typeId, nx, ny, item.uid)
        if (!check.ok) return fail(check.error ?: "無法移動")
        val dx = nx - item.x
        val dy = ny - item.y
        item.x = nx
        item.y = ny
        // 自動配來的椅子跟著搬
        for (cuid in item.chairUids ?: emptyList()) {
            val chair = findItem(state.layout, cuid)
            if (chair != null) { chair.x += dx; chair.y += dy }
        }
        return withLayoutChange(state) { ok() }
    }

    fun rotateFurniture(state: GameState, uid: String, rot: Int? = null, swapFootprint: Boolean = true): ActionResult {
        val item = findItem(state.layout, uid) ?: return fail("找不到這件傢俱")
        val def = furnitureById(item.typeId) ?: return fail("找不到這件傢俱")
        // 只有「有方向性」的傢俱（椅子、部分裝飾）旋轉才有意義
        val directional = listOf("chair", "table", "counter", "decor")
        if (def.category !in directional) return fail("${def.name} 沒有方向性，不需要旋轉")
        val next = if (rot != null) ((round(rot.toDouble()).toInt() % 4) + 4) % 4
                   else ((item.rot + 1) % 4)
        // 矩形傢俱旋轉時佔地要跟著換（1×2 ↔ 2×1）
        val swap = swapFootprint && def.w != def.h
        val w = if (swap) def.h else item.w
        val h = if (swap) def.w else item.h
        val check = canPlace(state.layout, item.typeId, item.x, item.y, item.uid)
        if (!check.ok && (w != item.w || h != item.h)) {
            return fail("這裡空間不夠旋轉，先把傢俱移開一點")
        }
        item.rot = next
        item.rotManual = true
        if (swap) { item.w = w; item.h = h }
        return withLayoutChange(state) { ok("已旋轉（方向 ${listOf("南", "東", "北", "西")[next]}）") }
    }

    fun replaceFurniture(state: GameState, uid: String, typeId: String): ActionResult {
        val item = findItem(state.layout, uid) ?: return fail("找不到這件傢俱")
        val oldDef = furnitureById(item.typeId)
        val newDef = furnitureById(typeId) ?: return fail("沒有這件傢俱")
        if (newDef.id == item.typeId) return fail("已經是同一件傢俱了")
        val refund = round((oldDef?.price ?: 0) * 0.5).toInt()
        val cost = maxOf(0, newDef.price - refund)
        if (state.cash < cost) {
            return fail("更換需要 NT$ ${formatMoney(cost)}（新傢俱 ${formatMoney(newDef.price)} − 舊品退款 ${formatMoney(refund)}）")
        }
        val check = canPlace(state.layout, newDef.id, item.x, item.y, item.uid)
        if (!check.ok) return fail("這個位置放不下 ${newDef.name}：${check.error}")
        state.cash -= cost
        state.stats.today.spend += cost
        state.layout.items = state.layout.items.filter { it.uid != uid }.toMutableList()
        state.layout.items.add(
            Item(
                uid, newDef.id, item.x, item.y, newDef.w, newDef.h, item.rot,
                100, false, rotManual = item.rotManual
            )
        )
        val msg = if (cost > 0) "已更換為 ${newDef.name}（補差額 NT$ ${formatMoney(cost)}）"
                  else "已更換為 ${newDef.name}（舊品退款足夠，不用補錢）"
        return withLayoutChange(state) { ok(msg) }
    }

    fun removeFurniture(state: GameState, uid: String): ActionResult {
        val item = findItem(state.layout, uid) ?: return fail("找不到這件傢俱")
        val def = furnitureById(item.typeId)
        val chairs = ownedItemUids(state, item.uid)
        val removed = removeItemsByIds(state, listOf(item.uid))
        // 只退掉「玩家當初真的花錢買的那一件」；自動配來的椅子是附贈的，不重複退錢
        val refund = round((def?.price ?: 0) * 0.5).toInt()
        state.cash += refund
        val extra = if (chairs.isNotEmpty()) "（連同 ${chairs.size} 張椅子一起拆除）" else ""
        val name = def?.name ?: item.typeId
        val msg = "已拆除 $name$extra，退回 NT$ ${formatMoney(refund)}（共移除 ${removed.size} 件）"
        return withLayoutChange(state) { ok(msg) }
    }

    fun clearLayout(state: GameState): ActionResult {
        val refund = round(layoutValue(state.layout) * 0.5).toInt()
        state.cash += refund
        state.layout.items = mutableListOf()
        state.sim.tables = mutableListOf()
        return withLayoutChange(state) { ok("已清空裝潢，退回 NT$ ${formatMoney(refund)}") }
    }

    fun setTileAction(state: GameState, tile: String, x: Int, y: Int): ActionResult {
        val allowed = listOf("floor", "wall", "kitchen", "pass", "restroom")
        if (tile !in allowed) return fail("不能改成這種地形")
        val cur = tileAt(state.layout, x, y)
        if (cur == "door") return fail("大門不能拆")
        if (cur == "pass" && tile != "pass") {
            val passCount = state.layout.passTiles.count { !(it.x.toInt() == x && it.y.toInt() == y) }
            if (passCount < 1) return fail("至少要留一個出餐口")
        }
        val cost = if (tile == "floor") 0 else 3000
        if (state.cash < cost) return fail("現金不足")
        state.cash -= cost
        setTile(state.layout, x, y, tile)
        val lt = state.layout
        if (tile == "pass") lt.passTiles.add(com.dreamrestaurant.sim.P(x, y))
        else lt.passTiles = lt.passTiles.filterNot { it.x.toInt() == x && it.y.toInt() == y }.toMutableList()
        if (tile == "restroom") lt.restroomTiles.add(com.dreamrestaurant.sim.P(x, y))
        else lt.restroomTiles = lt.restroomTiles.filterNot { it.x.toInt() == x && it.y.toInt() == y }.toMutableList()
        if (tile == "kitchen") lt.kitchenTiles.add(com.dreamrestaurant.sim.P(x, y))
        else lt.kitchenTiles = lt.kitchenTiles.filterNot { it.x.toInt() == x && it.y.toInt() == y }.toMutableList()
        return withLayoutChange(state) { ok("隔間已變更") }
    }

    /* ------------------------------------------------------ 維修與清潔 */

    fun upgradeKitchen(state: GameState, target: String): ActionResult {
        val spec = B.KITCHEN_SPECS[target] ?: return fail("沒有這項設備")
        val cur = when (target) {
            "stove" -> state.kitchen.stove
            "fridge" -> state.kitchen.fridge
            "prep" -> state.kitchen.prep
            else -> 1
        }
        if (cur >= B.KITCHEN_MAX_LEVEL) return fail("${spec.name} 已達最高等級 ${B.KITCHEN_MAX_LEVEL}")
        val cost = B.kitchenUpgradeCost(target, cur).toInt()
        if (state.cash < cost) return fail("現金不足（需要 NT$ ${formatMoney(cost)}）")
        state.cash -= cost
        state.stats.today.spend += cost
        when (target) {
            "stove" -> state.kitchen.stove = cur + 1
            "fridge" -> state.kitchen.fridge = cur + 1
            "prep" -> state.kitchen.prep = cur + 1
        }
        return ok("${spec.name} 升至等級 ${cur + 1}")
    }

    fun repair(state: GameState, target: String? = null, uid: String? = null): ActionResult {
        if (target != null) {
            if (target !in listOf("ac", "stove", "fridge")) return fail("沒有這項設備")
            val cost = when (target) {
                "ac" -> 12000
                "stove" -> 9000
                else -> 7000
            }
            if (state.cash < cost) return fail("現金不足")
            state.cash -= cost
            state.stats.today.repairs += cost
            state.stats.today.spend += cost
            when (target) {
                "ac" -> state.sim.equipBroken.ac = false
                "stove" -> state.sim.equipBroken.stove = false
                "fridge" -> state.sim.equipBroken.fridge = false
            }
            return ok("設備已修復")
        }
        val item = findItem(state.layout, uid ?: "") ?: return fail("找不到這件傢俱")
        val def = furnitureById(item.typeId)
        val damage = 100 - item.durability
        val cost = maxOf(200, round((def?.price ?: 1000) * 0.25 * (damage / 100.0) + 150).toInt())
        if (state.cash < cost) return fail("現金不足")
        state.cash -= cost
        state.stats.today.repairs += cost
        state.stats.today.spend += cost
        item.durability = 100
        item.broken = false
        return ok("已修好 ${def?.name ?: "傢俱"}（NT$ ${formatMoney(cost)}）")
    }

    fun clean(state: GameState, target: String): ActionResult {
        val t = if (target == "restroom") "restroom" else "floor"
        val cost = if (t == "restroom") B.CLEAN_RESTROOM_COST else B.CLEAN_FLOOR_COST
        if (state.cash < cost) return fail("現金不足")
        state.cash -= cost
        state.stats.today.spend += cost
        if (t == "restroom") state.sim.dirt.restroom = 0.0 else state.sim.dirt.floor = 0.0
        return if (t == "restroom") ok("廁所清潔完畢") else ok("店內清潔完畢")
    }

    /* ---------------------------------------------------------- 營業流程 */

    fun startDay(state: GameState): ActionResult {
        if (state.phase != "build") return fail("現在不是準備階段")
        if (!state.settings.openDays[(state.day - 1) % 7]) {
            return fail("今天是設定的公休日（可在「環境」調整營業日），員工今天不上班")
        }
        val activeMenu = state.menu.filter { it.active }
        if (activeMenu.isEmpty()) return fail("菜單是空的，先上架幾道菜")
        val hasStock = activeMenu.any { (state.stock[it.dishId] ?: 0) > 0 }
        if (!hasStock) return fail("庫存全是 0，先叫貨再開店")
        if (state.staff.none { it.role == "waiter" }) return fail("沒有服務生，客人不會自己端菜")
        if (state.staff.none { it.role == "chef" }) return fail("沒有廚師，無法出餐")
        if (seatCount(state.sim.tables) <= 0) return fail("沒有可用的座位，先擺張桌子")
        val anyUsable = state.sim.tables.any { it.usable }
        if (!anyUsable) return fail("桌子被擋住或離動線太遠，客人走不到位子")
        startBusiness(state)
        return ok("開始營業")
    }

    fun endDay(state: GameState): ActionResult {
        if (state.phase != "open") return fail("目前不是營業中")
        requestClose(state)
        return ok("打烊中，等客人離開")
    }

    fun nextDayAction(state: GameState): ActionResult {
        if (state.phase != "closed") return fail("今天的營業還沒結束")
        nextDay(state)
        return ok("第 ${state.day} 天開始")
    }

    /** 依 settings.openDays 決定今天是否營業 */
    fun cannotOpenToday(state: GameState): ActionResult = ok()

    fun lure(state: GameState, walkerUid: String? = null): ActionResult {
        if (state.phase != "open") return fail("還沒開始營業")
        val res = clickLure(state, walkerUid)
        return if (res.converted) ok("拉到一位客人進門！") else ok("向路人招手，人氣微微上升")
    }

    fun moveLocation(state: GameState, locationId: String): ActionResult {
        val loc = getLocation(locationId) ?: return fail("沒有這個地點")
        if (state.phase != "build" && state.phase != "closed") return fail("只能在打烊後搬遷")
        if (loc.id == state.locationId) return fail("已經在這個地點了")
        if (loc.starsRequired > state.stars) return fail("${loc.name} 需要 ${loc.starsRequired} 星")
        val refund = round(layoutValue(state.layout) * 0.3).toInt()
        val cost = loc.moveCost + loc.rentPerDay * 3
        if (state.cash + refund < cost) {
            return fail("搬遷需要 NT$ ${formatMoney(cost)}（裝潢退回 NT$ ${formatMoney(refund)}）")
        }
        state.cash += refund - cost
        state.stats.today.spend += cost
        state.locationId = loc.id
        val layout = defaultLayout(loc.id) { s -> nextUid(s as GameState) }
        // 新地點可能有開場傢俱（LAYOUT_VARIANTS[].items），這裡必須沿用 layout.items。
        layout.rev = state.layout.rev + 1
        state.layout = layout
        state.sim.tables = mutableListOf()
        state.reputation.outside = clamp(state.reputation.outside - B.MOVE_OUTSIDE_PENALTY, 0.0, 500.0)
        state.fame = clamp(state.fame * 0.85, 0.0, 100.0)
        state.sim.customers = mutableListOf()
        state.sim.tasks = mutableListOf()
        pushLog(state, "搬遷到 ${loc.name}，裝潢需要重新規劃，區外評價也掉了", "warn")
        return withLayoutChange(state) { ok("搬到 ${loc.name} 了！記得重新擺設桌椅") }
    }

    /* -------------------------------------------------------------- 系統 */

    fun ackSettle(state: GameState): ActionResult {
        state.flags.lastAckSettleDay = state.day
        return ok()
    }

    fun setTutorialDone(state: GameState): ActionResult {
        state.flags.tutorialDone = true
        return ok()
    }

    fun dismissUi(state: GameState): ActionResult {
        if (state.uiQueue.isNotEmpty()) state.uiQueue.removeAt(0)
        return ok()
    }

    fun rebuildRestaurant(state: GameState): ActionResult {
        val cost = 1
        if (state.cash < cost) return fail("現金不足（重建只要 NT$ 1）")
        // 清空現有裝潢
        state.layout.items = mutableListOf()
        state.sim.tables = mutableListOf()
        var placed = 0
        for ((typeId, x, y) in REBUILD_ITEMS) {
            val def = furnitureById(typeId) ?: continue
            val check = canPlace(state.layout, def.id, x, y)
            if (!check.ok) continue
            val uid = "rb$placed"
            val item = Item(uid, def.id, x, y, def.w, def.h, 0, 100, false)
            state.layout.items.add(item)
            if (def.category == "table") {
                item.chairUids = autoPlaceChairs(state, item) { s ->
                    val st = s as GameState
                    st.uidSeq = if (st.uidSeq >= 1) st.uidSeq + 1 else 2
                    "rb${st.uidSeq}"
                }.toMutableList()
            }
            placed += 1
        }
        state.cash -= cost
        state.kitchen = com.dreamrestaurant.core.KitchenLevels(5, 5, 5)
        return withLayoutChange(state) { ok("已重建頂級餐廳（NT$ 1），共 $placed 件頂級設備") }
    }

    fun autoShift(state: GameState): ActionResult {
        val open = state.settings.openMinute
        val close = state.settings.closeMinute
        if (close <= open) return fail("請先設定營業時間")
        val totalHours = (close - open) / 60.0
        val waiters = state.staff.filter { it.role == "waiter" }
        val chefs = state.staff.filter { it.role == "chef" }
        if (waiters.isEmpty() && chefs.isEmpty()) return fail("沒有員工可以排班")
        val blockHours = 8
        val blocksInTotal = kotlin.math.max(1, kotlin.math.ceil(totalHours / blockHours).toInt())
        val stepHours = if (totalHours <= blockHours) blockHours
            else kotlin.math.max(4, kotlin.math.ceil(totalHours / blocksInTotal).toInt())
        val numBlocks = kotlin.math.max(1, kotlin.math.ceil((totalHours - blockHours) / stepHours).toInt() + 1)
        fun assign(list: List<com.dreamrestaurant.core.HiredStaff>) {
            list.forEachIndexed { i, s ->
                val blockIdx = i % numBlocks
                val blockStart = open + blockIdx * stepHours * 60
                val blockEnd = kotlin.math.min(close, blockStart + blockHours * 60)
                s.shift = com.dreamrestaurant.core.Shift(blockStart, blockEnd)
            }
        }
        assign(waiters)
        assign(chefs)
        return ok("已自動排班：$numBlocks 班、每班 8 小時，服務生 ${waiters.size} 人、廚師 ${chefs.size} 人")
    }
}

/** 千分位金額（JS 的 toLocaleString('en-US')） */
fun formatMoney(v: Int): String = formatMoney(v.toDouble())

fun formatMoney(v: Double): String {
    val neg = v < 0
    val s = kotlin.math.abs(v).toLong().toString()
    val sb = StringBuilder()
    var count = 0
    for (i in s.indices.reversed()) {
        sb.append(s[i]); count++
        if (count % 3 == 0 && i > 0) sb.append(',')
    }
    val out = sb.reverse().toString()
    return (if (neg) "-$out" else out)
}
