package com.dreamrestaurant.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.dreamrestaurant.core.B
import com.dreamrestaurant.core.ActionResult
import com.dreamrestaurant.core.GameAction
import com.dreamrestaurant.core.GameState
import com.dreamrestaurant.core.GameStore
import com.dreamrestaurant.core.createNewGame
import com.dreamrestaurant.sim.stepSimulation
import com.dreamrestaurant.ui.audio.GameAudio

/**
 * 畫面背後的執行緒（其實是 UI 纖程）：
 * 持有 [GameStore]、以固定節奏把 `dtReal * speed * MINUTES_PER_SECOND * demoMul` 喂給 `stepSimulation`。
 *
 * `demoMul` 是**純 UI** 的快轉倍率，不寫進 `state.speed`，
 * 所以模擬語意與 JS 版完全一致（`state.speed` 只有 UI 會讀）。
 */
class GameRunner(seed: Long = 20240101L) {

    private val store = GameStore(createNewGame(seed))

    /** 每次 tick 遞增，用來觸發 Compose 重繪（GameState 是可變物件，不是 snapshot state） */
    var frame: Long by mutableLongStateOf(0L)
        private set

    /** 演示快轉倍率（1 / 5 / 20），不影響 state.speed */
    var demoMul: Int by mutableIntStateOf(5)
        private set

    /** 最近一次失敗訊息（按鈕提示用） */
    var lastError: String? by mutableStateOf(null)
        private set

    /** 音效開關（純 UI；JS 版的 sfx 是全域開關） */
    var soundOn: Boolean by mutableStateOf(true)
        private set

    fun state(): GameState = store.getState()

    fun dispatch(action: GameAction): ActionResult {
        val res = store.dispatch(action)
        if (!res.ok) lastError = res.error
        GameAudio.sfx(sfxFor(action, res.ok))
        if (action is GameAction.SetMusic) GameAudio.setMusic(action.id)
        frame += 1
        return res
    }

    fun toggleSound() {
        soundOn = !soundOn
        GameAudio.setEnabled(soundOn)
        frame += 1
    }

    /** 對齊 `src/main.js` 的呼叫點：成功時的提示音、失敗一律 error */
    private fun sfxFor(action: GameAction, ok: Boolean): String {
        if (!ok) return "error"
        return when (action) {
            is GameAction.StartDay -> "bell"
            is GameAction.EndDay -> "close"
            is GameAction.NextDay -> "open"
            is GameAction.SetSpeed -> "click"
            is GameAction.BuyStock -> "cash"
            is GameAction.PlaceFurniture -> "cash"
            is GameAction.ReplaceFurniture -> "cash"
            is GameAction.UpgradeKitchen -> "cash"
            is GameAction.Repair -> "cash"
            is GameAction.Clean -> "cash"
            is GameAction.Hire -> "coin"
            is GameAction.Fire -> "close"
            is GameAction.Lure -> "click"
            is GameAction.MoveLocation -> "cash"
            is GameAction.MenuAdd, is GameAction.MenuRemove -> "click"
            is GameAction.MenuToggle -> "click"
            else -> ""
        }
    }

    fun setFastForward(value: Int) {
        demoMul = value.coerceIn(1, 60)
        frame += 1
    }

    fun clearError() {
        lastError = null
    }

    /** 由畫面迴圈呼叫；[dtReal] 是距上次 tick 的實際秒數 */
    fun tick(dtReal: Double) {
        val state = store.getState()
        if (state.speed > 0 && (state.phase == "open" || state.phase == "closing")) {
            val dt = dtReal * state.speed * B.MINUTES_PER_SECOND * demoMul
            if (dt > 0) {
                try {
                    stepSimulation(state, dt)
                } catch (t: Throwable) {
                    lastError = t.message ?: t.toString()
                }
            }
        }
        frame += 1
    }
}
