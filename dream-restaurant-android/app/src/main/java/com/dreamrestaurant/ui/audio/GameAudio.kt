package com.dreamrestaurant.ui.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.pow

/**
 * 程序化音效 + BGM 引擎 —— 對應 `src/core/audio.js`（不載入任何外部音檔）。
 *
 * 架構：單一執行緒的軟體混音器，把 BGM 音符與 SFX 疊進同一個
 * [AudioTrack.MODE_STREAM] 輸出，因此支援 sample-accurate 的排程。
 */
object GameAudio {

    private const val TAG = "DreamVoice"
    private const val CHUNK = 2048
    /** SFX 提前量：確保事件發生時該音符還在待處理佇列裡（約 140ms） */
    private const val LEAD = 6144

    private val lock = Any()
    private val pending = ArrayList<Voice>(16)
    private val voices = ArrayList<Voice>(32)

    private var track: AudioTrack? = null
    private var worker: Thread? = null

    @Volatile private var stopped = false
    @Volatile private var started = false
    @Volatile private var active = true
    @Volatile private var enabled = true
    @Volatile private var cursor = 0L

    private var musicStyle = "off"
    private var musicNext = -1L
    private var musicStep = 0

    /** 已知的 BGM 樣式（同 `B.MUSIC_NAME` 的鍵） */
    val musicIds: List<String> = listOf("lazy", "tropical", "classic1", "classic2", "pop", "off")

    /* ------------------------------------------------------------- 日語語音 */

    /** 模擬事件 → 日語台詞（TTS 播出） */
    private val PHRASES: Map<String, String> = mapOf(
        "welcome" to "いらっしゃいませ",
        "order" to "かしこまりました",
        "cash" to "ありがとうございます",
        "thanks" to "ごちそうさまでした"
    )

    /** TTS 不可用（沒引擎／沒日語語音檔）時的替代音效 */
    private val VOICE_FALLBACK: Map<String, String> = mapOf(
        "welcome" to "bell",
        "order" to "open",
        "cash" to "cash",
        "thanks" to "close"
    )

    /** 同一種語音的最小間隔（毫秒）：客人多時才不會連珠炮 */
    private val VOICE_GAP: Map<String, Long> = mapOf(
        "welcome" to 2000L,
        "order" to 1600L,
        "cash" to 1400L,
        "thanks" to 2000L
    )

    private var tts: TextToSpeech? = null
    @Volatile private var ttsReady = false
    @Volatile private var voiceEnabled = true
    private val speaking = AtomicInteger(0)
    private val lastSaid = HashMap<String, Long>()

    /** 由 Activity 呼叫一次；TTS 初始化非同步，失敗自動退回音效 */
    fun attach(context: Context) {
        if (tts != null) return
        try {
            var engine: TextToSpeech? = null
            engine = TextToSpeech(context.applicationContext) { status ->
                val t = engine ?: tts
                if (status != TextToSpeech.SUCCESS || t == null) {
                    ttsReady = false
                    return@TextToSpeech
                }
                val lang = t.setLanguage(Locale.JAPANESE)
                ttsReady = lang != TextToSpeech.LANG_MISSING_DATA && lang != TextToSpeech.LANG_NOT_SUPPORTED
                Log.d(TAG, "TTS 初始化 status=$status ja=$ttsReady lang=$lang")
                if (!ttsReady) return@TextToSpeech
                t.setSpeechRate(1.05f)
                t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) = releaseSlot()
                    override fun onError(utteranceId: String?) = releaseSlot()
                    override fun onError(utteranceId: String?, errorCode: Int) = releaseSlot()
                })
            }
            tts = engine
        } catch (_: Throwable) {
            tts = null
            ttsReady = false
        }
    }

    private fun releaseSlot() {
        speaking.updateAndGet { n -> if (n > 0) n - 1 else 0 }
    }

    fun isVoiceEnabled(): Boolean = voiceEnabled

    fun setVoiceEnabled(v: Boolean) {
        voiceEnabled = v
        Log.d(TAG, "voiceEnabled=$v")
        if (!v) stopSpeech()
    }

    private fun stopSpeech() {
        speaking.set(0)
        try {
            tts?.stop()
        } catch (_: Throwable) {
        }
    }

    /** 播一句日語；TTS 不可用時改播替代音效 */
    fun speak(event: String) {
        if (!enabled || !voiceEnabled || !active) return
        val text = PHRASES[event] ?: return
        val now = SystemClock.uptimeMillis()
        synchronized(lastSaid) {
            val last = lastSaid[event] ?: 0L
            if (now - last < (VOICE_GAP[event] ?: 1600L)) return
            lastSaid[event] = now
        }
        val t = tts
        if (!ttsReady || t == null) {
            Log.d(TAG, "TTS 不可用，$event 退回音效")
            sfx(VOICE_FALLBACK[event] ?: "click")
            return
        }
        if (speaking.get() >= 2) return
        speaking.incrementAndGet()
        val r = t.speak(text, TextToSpeech.QUEUE_ADD, null, "dream-$event-$now")
        Log.d(TAG, "speak $event -> $r")
        if (r != TextToSpeech.SUCCESS) {
            releaseSlot()
            sfx(VOICE_FALLBACK[event] ?: "click")
        }
    }

    fun isStarted(): Boolean = started
    fun isEnabled(): Boolean = enabled
    fun getMusic(): String = synchronized(lock) { musicStyle }

    /* ------------------------------------------------------------- 生命週期 */

    fun start() {
        if (started) return
        synchronized(this) {
            if (started) return
            try {
                val minBuf = AudioTrack.getMinBufferSize(
                    SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT
                )
                val t = AudioTrack.Builder()
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_GAME)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    )
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build()
                    )
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .setBufferSizeInBytes(maxOf(minBuf, CHUNK * 8))
                    .build()
                t.play()
                track = t
            } catch (_: Throwable) {
                track = null
            }
            stopped = false
            started = true
            worker = Thread({ runLoop() }, "dream-audio").apply {
                isDaemon = true
                priority = Thread.NORM_PRIORITY + 1
                start()
            }
        }
    }

    fun stop() {
        val t: Thread?
        val tr: AudioTrack?
        synchronized(this) {
            if (!started) return
            stopped = true
            t = worker
            tr = track
            worker = null
            track = null
            started = false
        }
        try {
            t?.interrupt()
            t?.join(300)
        } catch (_: Throwable) {
        }
        try {
            tr?.release()
        } catch (_: Throwable) {
        }
        shutdownSpeech()
    }

    private fun shutdownSpeech() {
        val engine = tts
        tts = null
        ttsReady = false
        speaking.set(0)
        try {
            engine?.stop()
            engine?.shutdown()
        } catch (_: Throwable) {
        }
    }

    /** Activity 切到背景時暫停（音樂會停在原處，回來再續播） */
    fun setActive(v: Boolean) {
        if (active == v) return
        active = v
        if (!v) stopSpeech()
        synchronized(lock) {
            pending.clear()
            musicNext = -1L
        }
        try {
            if (v) track?.play() else track?.pause()
        } catch (_: Throwable) {
        }
    }

    /* ------------------------------------------------------------------ API */

    fun setEnabled(v: Boolean) {
        enabled = v
        if (!v) stopSpeech()
        synchronized(lock) {
            if (v) musicNext = -1L
        }
    }

    fun setMusic(style: String) {
        val id = if (style in musicIds) style else "off"
        synchronized(lock) {
            if (id == musicStyle) return
            musicStyle = id
            musicNext = -1L
            musicStep = 0
        }
    }

    fun sfx(name: String) {
        if (!enabled || !active) return
        start()
        if (!started) return
        val pattern = SFX[name] ?: SFX["click"] ?: return
        val base = cursor + LEAD
        synchronized(lock) {
            if (voices.size + pending.size > 96) return
            for (op in pattern) pending.add(op.toVoice(base))
        }
    }

    /* -------------------------------------------------------------- 混音迴圈 */

    private fun runLoop() {
        val mix = FloatArray(CHUNK)
        val out = ShortArray(CHUNK)
        while (!stopped) {
            if (!active) {
                try {
                    Thread.sleep(60)
                } catch (_: InterruptedException) {
                }
                continue
            }
            val tr = track ?: break
            val cur = cursor
            synchronized(lock) {
                drainPendingLocked()
                scheduleMusicLocked(cur, CHUNK)
                voices.removeAll { it.end <= cur }
            }
            mix.fill(0f, 0, CHUNK)
            synchronized(lock) {
                for (v in voices) v.accumulate(mix, cur, CHUNK)
            }
            for (i in 0 until CHUNK) {
                var s = mix[i]
                if (s > 1f) s = 1f else if (s < -1f) s = -1f
                out[i] = (s * 32767f).toInt().toShort()
            }
            var off = 0
            while (off < CHUNK && !stopped && active) {
                val w = try {
                    tr.write(out, off, CHUNK - off)
                } catch (_: Throwable) {
                    -1
                }
                if (w <= 0) break
                off += w
            }
            cursor = cur + CHUNK
        }
    }

    private fun drainPendingLocked() {
        if (pending.isEmpty()) return
        voices.addAll(pending)
        pending.clear()
    }

    private fun scheduleMusicLocked(cur: Long, n: Int) {
        val conf = SCALES[musicStyle]
        if (conf == null || !enabled) {
            musicNext = -1L
            return
        }
        if (musicNext < 0L || musicNext < cur) musicNext = cur
        val beatSamples = ((60.0 / conf.tempo / 2.0) * SAMPLE_RATE).toLong().coerceAtLeast(1L)
        var guard = 0
        while (musicNext < cur + n && guard < 8) {
            scheduleStepLocked(musicNext)
            musicNext += beatSamples
            guard++
        }
    }

    private fun scheduleStepLocked(at: Long) {
        val conf = SCALES[musicStyle] ?: return
        val beat = 60.0 / conf.tempo / 2.0
        val note = conf.notes[musicStep % conf.notes.size]
        val bassNote = conf.bass[(musicStep / 4) % conf.bass.size]
        voices.add(
            voiceAt(
                at,
                toneOp(0.0, semitone(conf.base, note), beat * 0.85, conf.wave, 0.12, 0.0, BUS_MUSIC)
            )
        )
        if (musicStep % 4 == 0) {
            voices.add(
                voiceAt(
                    at,
                    toneOp(0.0, semitone(conf.base / 2.0, bassNote), beat * 3, WAVE_TRIANGLE, 0.14, 0.0, BUS_MUSIC)
                )
            )
        }
        if (musicStep % 8 == 4) {
            voices.add(voiceAt(at, noiseOp(0.0, 0.05, 0.04, 4000.0, BUS_SFX)))
        }
        musicStep += 1
    }

    /** 把一筆 [Op] 排在絕對取樣點 [start]（`Op.at` 是 SFX 用的相對秒數，這裡忽略它） */
    private fun voiceAt(start: Long, op: Op): Voice {
        val durSamples = (op.dur * SAMPLE_RATE).toInt().coerceAtLeast(1)
        return if (op.noise) {
            Voice(start, durSamples, KIND_NOISE, 0.0, 0.0, 0, op.gain, op.hp, op.bus)
        } else {
            Voice(start, durSamples, KIND_TONE, op.freq, op.slideTo, op.wave, op.gain, 0.0, op.bus)
        }
    }
}

private fun semitone(base: Double, semi: Number): Double = base * (2.0).pow(semi.toDouble() / 12.0)

private class Scale(
    val tempo: Int,
    val notes: IntArray,
    val base: Double,
    val wave: Int,
    val bass: IntArray
)

private val SCALES = mapOf(
    "lazy" to Scale(104, intArrayOf(0, 3, 5, 7, 10, 12, 10, 7, 5, 3), 262.0, WAVE_TRIANGLE, intArrayOf(0, -5, -7, -5)),
    "tropical" to Scale(120, intArrayOf(0, 4, 7, 12, 7, 4, 2, 7), 294.0, WAVE_SQUARE, intArrayOf(0, 5, 7, 5)),
    "classic1" to Scale(88, intArrayOf(0, 2, 4, 7, 9, 7, 4, 2), 233.0, WAVE_SINE, intArrayOf(0, -3, -5, -7)),
    "classic2" to Scale(76, intArrayOf(0, 4, 7, 11, 12, 11, 7, 4), 196.0, WAVE_SINE, intArrayOf(0, -4, -7, -5)),
    "pop" to Scale(132, intArrayOf(0, 4, 7, 9, 12, 9, 7, 4), 330.0, WAVE_SQUARE, intArrayOf(0, 5, 9, 7))
)

/** 與 `SFX` 表逐項對齊（含 `pour`／`door` 這兩個定義了但 Web 沒呼叫的） */
private val SFX: Map<String, List<Op>> = buildMap {
    put("click", listOf(toneOp(0.0, 880.0, 0.04, WAVE_SQUARE, 0.14)))
    put(
        "open", listOf(
            toneOp(0.0, 620.0, 0.07, WAVE_SQUARE, 0.16),
            toneOp(0.06, 930.0, 0.07, WAVE_SQUARE, 0.12)
        )
    )
    put(
        "close", listOf(
            toneOp(0.0, 520.0, 0.06, WAVE_SQUARE, 0.14),
            toneOp(0.05, 320.0, 0.08, WAVE_SQUARE, 0.12)
        )
    )
    put(
        "bell", listOf(
            toneOp(0.0, 1320.0, 0.5, WAVE_TRIANGLE, 0.24),
            toneOp(0.02, 1980.0, 0.4, WAVE_SINE, 0.12)
        )
    )
    put(
        "cash", listOf(
            noiseOp(0.0, 0.12, 0.16, 2200.0),
            toneOp(0.0, 1568.0, 0.1, WAVE_TRIANGLE, 0.2),
            toneOp(0.07, 2093.0, 0.18, WAVE_TRIANGLE, 0.16)
        )
    )
    put("error", listOf(toneOp(0.0, 220.0, 0.18, WAVE_SAW, 0.2, slideTo = 120.0)))
    put("pour", listOf(noiseOp(0.0, 0.22, 0.12, 1200.0)))
    put(
        "star",
        (listOf(523.0, 659.0, 784.0, 1047.0).mapIndexed { i, f ->
            toneOp(i * 0.12, f, 0.28, WAVE_SQUARE, 0.2)
        }) + toneOp(0.5, 1568.0, 0.5, WAVE_TRIANGLE, 0.16)
    )
    put(
        "settle", listOf(
            toneOp(0.0, 784.0, 0.16, WAVE_SQUARE, 0.2),
            toneOp(0.14, 1047.0, 0.3, WAVE_SQUARE, 0.18)
        )
    )
    put("alarm", (0..2).map { i -> toneOp(i * 0.2, 740.0, 0.12, WAVE_SQUARE, 0.2) })
    put(
        "door", listOf(
            noiseOp(0.0, 0.08, 0.1, 1500.0),
            toneOp(0.0, 1200.0, 0.3, WAVE_SINE, 0.14)
        )
    )
    put(
        "coin", listOf(
            toneOp(0.0, 1760.0, 0.06, WAVE_SQUARE, 0.16),
            toneOp(0.05, 2349.0, 0.1, WAVE_SQUARE, 0.12)
        )
    )
}
