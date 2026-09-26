package com.dreamrestaurant.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import com.dreamrestaurant.core.B
import com.dreamrestaurant.core.ActionResult
import com.dreamrestaurant.core.GameAction
import com.dreamrestaurant.core.GameState
import com.dreamrestaurant.core.GameStore
import com.dreamrestaurant.core.SaveManager
import com.dreamrestaurant.core.SlotInfo
import com.dreamrestaurant.core.SoundBus
import com.dreamrestaurant.core.UiMsg
import com.dreamrestaurant.core.createNewGame
import com.dreamrestaurant.sim.stepSimulation
import com.dreamrestaurant.ui.audio.GameAudio
import java.io.File

private const val ZOOM_MIN = 0.5f
private const val ZOOM_MAX = 5f

/**
 * 畫面背後的執行緒（其實是 UI 纖程）：
 * 持有 [GameStore]、以固定節奏把 `dtReal * speed * MINUTES_PER_SECOND * demoMul` 喂給 `stepSimulation`。
 *
 * `demoMul` 是**純 UI** 的快轉倍率，不寫進 `state.speed`，
 * 所以模擬語意與 JS 版完全一致（`state.speed` 只有 UI 會讀）。
 */
class GameRunner(seed: Long = 20240101L, saveDir: File? = null) {

    private val saveManager: SaveManager? = saveDir?.let { SaveManager(FileSaveStorage(it)) }

    private val store = GameStore(createNewGame(seed), saveManager)

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

    /** 日語語音開關（客人進門／點餐／結帳／離店） */
    var voiceOn: Boolean by mutableStateOf(true)
        private set

    /** 目前開啟的面板 id（null = 沒有）。對應網頁版的視窗管理器 */
    var openPanel: String? by mutableStateOf(null)
        private set

    fun togglePanel(id: String) {
        openPanel = if (openPanel == id) null else id
        frame += 1
    }

    fun closePanel() {
        if (openPanel != null) {
            openPanel = null
            frame += 1
        }
    }

    /** 存檔槽位清單（無存檔管理時回空） */
    fun saveSlots(): List<SlotInfo> = saveManager?.listSlots() ?: emptyList()

    /* ---------------------------------------------------------- 視圖（純 UI） */

    /** 畫布尺寸，由 RoomCanvas 的 onSizeChanged 更新 */
    var canvasW: Float = 0f
    var canvasH: Float = 0f

    /** 縮放倍率（1 = 適合畫面） */
    var zoom: Float by mutableFloatStateOf(1f)
        private set

    /** 平移（畫布像素，疊在「適合畫面」的平移上） */
    var panX: Float by mutableFloatStateOf(0f)
        private set

    var panY: Float by mutableFloatStateOf(0f)
        private set

    /** 「適合畫面」的 (縮放, 平移)；畫布還沒量到尺寸時回 null */
    fun fitTransform(): Pair<Float, Offset>? {
        if (canvasW <= 0f || canvasH <= 0f) return null
        val layout = store.getState().layout
        return Iso.fit(Iso.contentBox(layout), canvasW, canvasH, 10f)
    }

    /** 店內中心的邏輯座標（縮放／平移的錨點參考） */
    fun roomCenter(): Offset {
        val layout = store.getState().layout
        return Iso.at(layout.gridW / 2f, layout.gridH / 2f)
    }

    /**
     * 手勢：以畫布座標 [centroid] 為錨做 [factor] 縮放，外加 [panDelta] 位移。
     * [base] / [tr] 是「適合畫面」的縮放與平移。
     */
    fun applyGesture(
        base: Float,
        tr: Offset,
        factor: Float,
        centroid: Offset,
        panDelta: Offset,
        roomCenter: Offset
    ) {
        val newZoom = (zoom * factor).coerceIn(ZOOM_MIN, ZOOM_MAX)
        val nd = if (zoom > 0f) newZoom / zoom else 1f
        val trEff = Offset(tr.x + panX, tr.y + panY)
        var nt = centroid + (trEff - centroid) * nd + panDelta

        // 別把整間店拖出畫面：店中心至少要留在畫布內
        if (canvasW > 0f && canvasH > 0f) {
            val s = base * newZoom
            val cx = nt.x + roomCenter.x * s
            val cy = nt.y + roomCenter.y * s
            nt = Offset(
                nt.x + (cx.coerceIn(0f, canvasW) - cx),
                nt.y + (cy.coerceIn(0f, canvasH) - cy)
            )
        }

        zoom = newZoom
        panX = nt.x - tr.x
        panY = nt.y - tr.y
        frame += 1
    }

    /** 縮放鈕：以畫布中心為錨 */
    fun zoomByButton(factor: Float) {
        val (base, tr) = fitTransform() ?: return
        applyGesture(
            base, tr, factor,
            Offset(canvasW / 2f, canvasH / 2f),
            Offset.Zero,
            roomCenter()
        )
    }

    /** 回到適合畫面 */
    fun resetView() {
        zoom = 1f
        panX = 0f
        panY = 0f
        frame += 1
    }

    /* ------------------------------------------------------------ 提示訊息 */

    /** 把 store 累積的提示轉成 uiQueue 的 toast（對齊 main.js 每 180ms drain 一次） */
    private fun drainNotices() {
        val notices = store.drainNotices()
        if (notices.isEmpty()) return
        val state = store.getState()
        for (n in notices) {
            state.uiQueue.add(UiMsg(type = "toast", message = n.message, kind = n.kind))
        }
    }

    fun state(): GameState = store.getState()

    fun dispatch(action: GameAction): ActionResult {
        val res = store.dispatch(action)
        if (!res.ok) lastError = res.error
        GameAudio.sfx(sfxFor(action, res.ok))
        if (action is GameAction.SetMusic) GameAudio.setMusic(action.id)
        drainNotices()
        frame += 1
        return res
    }

    fun toggleSound() {
        soundOn = !soundOn
        GameAudio.setEnabled(soundOn)
        frame += 1
    }

    fun toggleVoice() {
        voiceOn = !voiceOn
        GameAudio.setVoiceEnabled(voiceOn)
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
            is GameAction.SaveGame, is GameAction.LoadGame -> "click"
            else -> "click"
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
        drainNotices()
        // 模擬事件 → 日語語音（TTS 不可用時 GameAudio 會自動退回音效）
        for (event in SoundBus.drain()) GameAudio.speak(event)
        frame += 1
    }
}
