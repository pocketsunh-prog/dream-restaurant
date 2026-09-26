package com.dreamrestaurant.core

/**
 * 模擬層 → UI 的「語音事件」管線。
 *
 * core 不依賴 Android API，所以模擬只把事件名稱丟進這裡，
 * 由 UI（[com.dreamrestaurant.ui.audio.GameAudio]）排隊轉成日語 TTS 播出。
 *
 * 事件名稱：
 *  - `welcome` 客人進門
 *  - `order`   服務生點完餐、開始出餐
 *  - `cash`    結帳收款
 *  - `thanks`  客人吃飽離店
 */
object SoundBus {

    private const val MAX = 8
    private val queue = ArrayDeque<String>()

    fun emit(event: String) {
        synchronized(queue) {
            if (queue.size >= MAX) queue.removeFirst()
            queue.addLast(event)
        }
    }

    /** 取出並清空待播事件 */
    fun drain(): List<String> = synchronized(queue) {
        if (queue.isEmpty()) emptyList()
        else {
            val out = queue.toList()
            queue.clear()
            out
        }
    }

    fun clear() {
        synchronized(queue) { queue.clear() }
    }
}
