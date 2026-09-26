package com.dreamrestaurant.core

/* ------------------------------------------------------------ action 定義 */

sealed class GameAction {
    /* 時間控制 */
    data class SetSpeed(val value: Int) : GameAction()
    data class SetHours(val openMinute: Int? = null, val closeMinute: Int? = null) : GameAction()
    data class ToggleDay(val index: Int) : GameAction()
    data class SetAc(val temp: Int) : GameAction()
    data class SetFx(val key: String, val on: Boolean) : GameAction()
    data class SetSetting(val key: String, val value: Any?) : GameAction()
    data class SetMusic(val id: String) : GameAction()

    /* 菜單 */
    data class MenuAdd(val dishId: String) : GameAction()
    data class MenuRemove(val dishId: String) : GameAction()
    data class MenuUpdate(val dishId: String, val patch: MenuPatch) : GameAction()
    data class MenuToggle(val dishId: String) : GameAction()

    /* 進貨 */
    data class BuyStock(val dishId: String, val servings: Int = 10) : GameAction()

    /* 員工 */
    data class Hire(val candidateId: String) : GameAction()
    data class Fire(val uid: String) : GameAction()
    data class SetWage(val uid: String, val wage: Int) : GameAction()
    data class SetShift(val uid: String, val start: Int, val end: Int) : GameAction()
    data class SetDuty(val uid: String, val duty: String, val on: Boolean) : GameAction()

    /* 裝潢 */
    data class PlaceFurniture(val typeId: String, val x: Int? = null, val y: Int? = null, val rot: Int = 0) : GameAction()
    data class MoveFurniture(val uid: String, val x: Int, val y: Int) : GameAction()
    data class RotateFurniture(val uid: String, val rot: Int? = null, val swapFootprint: Boolean = true) : GameAction()
    data class ReplaceFurniture(val uid: String, val typeId: String) : GameAction()
    data class RemoveFurniture(val uid: String) : GameAction()
    object ClearLayout : GameAction()
    data class SetTile(val tile: String, val x: Int, val y: Int) : GameAction()

    /* 維修與清潔 */
    data class UpgradeKitchen(val target: String) : GameAction()
    data class Repair(val target: String? = null, val uid: String? = null) : GameAction()
    data class Clean(val target: String) : GameAction()

    /* 營業流程 */
    object StartDay : GameAction()
    object EndDay : GameAction()
    object NextDay : GameAction()
    object CannotOpenToday : GameAction()
    data class Lure(val walkerUid: String? = null) : GameAction()
    data class MoveLocation(val locationId: String) : GameAction()

    /* 系統 */
    object AckSettle : GameAction()
    object SetTutorialDone : GameAction()
    object DismissUi : GameAction()
    object RebuildRestaurant : GameAction()
    object AutoShift : GameAction()

    /* 存讀檔（store 處理） */
    data class SaveGame(val slot: String = "1") : GameAction()
    data class LoadGame(val slot: String = "1") : GameAction()
    data class NewGame(val seed: Long? = null) : GameAction()
}

/** reducer：就地修改 state，回傳 ActionResult */
fun reduce(state: GameState?, action: GameAction?): ActionResult {
    if (state == null || action == null) return ActionResult.fail("無效的操作")
    return when (action) {
        is GameAction.SetSpeed -> Actions.setSpeed(state, action.value)
        is GameAction.SetHours -> Actions.setHours(state, action.openMinute, action.closeMinute)
        is GameAction.ToggleDay -> Actions.toggleDay(state, action.index)
        is GameAction.SetAc -> Actions.setAc(state, action.temp)
        is GameAction.SetFx -> Actions.setFx(state, action.key, action.on)
        is GameAction.SetSetting -> Actions.setSetting(state, action.key, action.value)
        is GameAction.SetMusic -> Actions.setMusic(state, action.id)

        is GameAction.MenuAdd -> Actions.menuAdd(state, action.dishId)
        is GameAction.MenuRemove -> Actions.menuRemove(state, action.dishId)
        is GameAction.MenuUpdate -> Actions.menuUpdate(state, action.dishId, action.patch)
        is GameAction.MenuToggle -> Actions.menuToggle(state, action.dishId)

        is GameAction.BuyStock -> Actions.buyStock(state, action.dishId, action.servings)

        is GameAction.Hire -> Actions.hire(state, action.candidateId)
        is GameAction.Fire -> Actions.fire(state, action.uid)
        is GameAction.SetWage -> Actions.setWage(state, action.uid, action.wage)
        is GameAction.SetShift -> Actions.setShift(state, action.uid, action.start, action.end)
        is GameAction.SetDuty -> Actions.setDuty(state, action.uid, action.duty, action.on)

        is GameAction.PlaceFurniture -> Actions.placeFurniture(state, action.typeId, action.x, action.y, action.rot)
        is GameAction.MoveFurniture -> Actions.moveFurniture(state, action.uid, action.x, action.y)
        is GameAction.RotateFurniture -> Actions.rotateFurniture(state, action.uid, action.rot, action.swapFootprint)
        is GameAction.ReplaceFurniture -> Actions.replaceFurniture(state, action.uid, action.typeId)
        is GameAction.RemoveFurniture -> Actions.removeFurniture(state, action.uid)
        is GameAction.ClearLayout -> Actions.clearLayout(state)
        is GameAction.SetTile -> Actions.setTileAction(state, action.tile, action.x, action.y)

        is GameAction.UpgradeKitchen -> Actions.upgradeKitchen(state, action.target)
        is GameAction.Repair -> Actions.repair(state, action.target, action.uid)
        is GameAction.Clean -> Actions.clean(state, action.target)

        is GameAction.StartDay -> Actions.startDay(state)
        is GameAction.EndDay -> Actions.endDay(state)
        is GameAction.NextDay -> Actions.nextDayAction(state)
        is GameAction.CannotOpenToday -> Actions.cannotOpenToday(state)
        is GameAction.Lure -> Actions.lure(state, action.walkerUid)
        is GameAction.MoveLocation -> Actions.moveLocation(state, action.locationId)

        is GameAction.AckSettle -> Actions.ackSettle(state)
        is GameAction.SetTutorialDone -> Actions.setTutorialDone(state)
        is GameAction.DismissUi -> Actions.dismissUi(state)
        is GameAction.RebuildRestaurant -> Actions.rebuildRestaurant(state)
        is GameAction.AutoShift -> Actions.autoShift(state)

        is GameAction.SaveGame, is GameAction.LoadGame, is GameAction.NewGame ->
            ActionResult.fail("這個操作由 store 處理")
    }
}

/* -------------------------------------------------------------- 容器 */

data class Notice(val kind: String, val message: String)

/** 極簡狀態容器：dispatch / subscribe / refreshAll */
class GameStore(
    initialState: GameState? = null,
    private val saveManager: SaveManager? = null
) {
    private var state: GameState = initialState ?: createNewGame()
    private val subscribers = mutableSetOf<(GameState) -> Unit>()
    private var notices = mutableListOf<Notice>()
    private var rev = 0

    val revision: Int get() = rev

    fun getState(): GameState = state

    fun subscribe(fn: (GameState) -> Unit): () -> Unit {
        subscribers.add(fn)
        return { subscribers.remove(fn) }
    }

    fun <T> select(fn: (GameState) -> T): T = fn(state)

    private fun emit() {
        rev += 1
        state.rev = rev
        for (fn in subscribers.toList()) {
            try {
                fn(state)
            } catch (err: Throwable) {
                System.err.println("[store] 訂閱者發生錯誤: $err")
            }
        }
    }

    private fun pushNotice(notice: Notice) {
        notices.add(notice)
        if (notices.size > 30) notices = notices.drop(notices.size - 30).toMutableList()
    }

    /** 取出累積的提示訊息（給 UI 顯示 toast） */
    fun drainNotices(): List<Notice> {
        val out = notices
        notices = mutableListOf()
        return out
    }

    fun dispatch(action: GameAction?): ActionResult {
        if (action == null) return ActionResult.fail("無效的操作")

        // 存讀檔與新遊戲由 store 處理
        if (action is GameAction.SaveGame) {
            val mgr = saveManager ?: return ActionResult.fail("這個環境不支援存檔")
            val res = mgr.save(state, action.slot)
            if (res.ok) {
                val slot = action.slot
                pushNotice(Notice("good", "已存檔到槽位 $slot"))
                emit()
                return ActionResult.ok("存檔完成")
            }
            return res
        }
        if (action is GameAction.LoadGame) {
            val mgr = saveManager ?: return ActionResult.fail("這個環境不支援讀檔")
            val res = mgr.load(action.slot)
            if (!res.ok) return ActionResult.fail(res.error ?: "讀檔失敗")
            val next = res.state ?: return ActionResult.fail("存檔格式錯誤")
            state = next
            rev += 1
            state.rev = rev
            pushNotice(Notice("info", "讀檔完成"))
            emit()
            return ActionResult.ok("讀檔完成")
        }
        if (action is GameAction.NewGame) {
            state = createNewGame(action.seed ?: Rng.newSeed())
            rev += 1
            state.rev = rev
            emit()
            return ActionResult.ok("新遊戲開始")
        }

        val result = try {
            reduce(state, action)
        } catch (err: Throwable) {
            System.err.println("[store] reducer 例外: $err")
            return ActionResult.fail("內部錯誤：${err.message}")
        }
        if (result.ok) {
            result.info?.let { pushNotice(Notice("info", it)) }
            emit()
        }
        return result
    }

    /** 直接替換狀態（讀檔、外部注入、測試用） */
    fun replaceState(next: GameState, silent: Boolean = false): GameState {
        state = next
        rev += 1
        state.rev = rev
        if (!silent) emit()
        return state
    }

    fun autoSave(): ActionResult =
        saveManager?.save(state, AUTO_SLOT, "每日自動存檔") ?: ActionResult.fail("這個環境不支援存檔")
}
