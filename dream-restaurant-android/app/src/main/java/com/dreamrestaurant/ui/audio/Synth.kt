package com.dreamrestaurant.ui.audio

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.pow
import kotlin.math.sin

const val SAMPLE_RATE = 44100

const val WAVE_SINE = 0
const val WAVE_SQUARE = 1
const val WAVE_TRIANGLE = 2
const val WAVE_SAW = 3

/** sfxGain(0.5) × master(0.5)，對應 WebAudio 的兩層 gain */
const val BUS_SFX = 0.25
/** musicGain(0.22) × master(0.5) */
const val BUS_MUSIC = 0.11

private const val ATTACK = 0.012
private const val FLOOR = 0.0001

/** 一筆要在時間軸上疊進混音的聲音（WebAudio 的 oscillator／bufferSource 等價物） */
class Voice(
    val start: Long,
    val durSamples: Int,
    val kind: Int,
    val freq: Double,
    val slideTo: Double,
    val wave: Int,
    val gain: Double,
    val hp: Double,
    val bus: Double
) {
    var phase = 0.0
    var hpX = 0.0
    var hpY = 0.0
    var noiseState = 0x2545f491

    val end: Long get() = start + durSamples

    /** 把落在畫布區間 [cursor, cursor+n) 的部分加總進 mix */
    fun accumulate(mix: FloatArray, cursor: Long, n: Int) {
        val from = if (start > cursor) (start - cursor).toInt() else 0
        val untilRaw = end - cursor
        val until = if (untilRaw < n) untilRaw.toInt() else n
        if (from >= until) return

        val durSec = durSamples / SAMPLE_RATE.toDouble()
        val hpA = 1.0 / (1.0 + 2.0 * PI * hp / SAMPLE_RATE)
        var i = from
        while (i < until) {
            val k = (cursor + i - start) / SAMPLE_RATE.toDouble()
            val amp: Double
            var v: Double
            if (kind == KIND_TONE) {
                amp = envTone(k, durSec)
                if (amp > 0.0) {
                    val f = if (slideTo > 0.0) freq * (slideTo / freq).pow(k / durSec) else freq
                    phase += f / SAMPLE_RATE
                    v = waveOf(phase) * amp
                } else {
                    v = 0.0
                }
            } else {
                amp = gain
                val x = nextNoise() * (1.0 - (cursor + i - start).toDouble() / durSamples)
                hpY = hpA * (hpY + x - hpX)
                hpX = x
                v = hpY * amp
            }
            if (v != 0.0) {
                val s = (v * bus).toFloat()
                mix[i] = mix[i] + s
            }
            i++
        }
    }

    /** WebAudio 的 exponentialRamp 兩段包絡（攻擊 12ms、再指數衰減到 FLOOR） */
    private fun envTone(t: Double, durSec: Double): Double {
        if (t < 0.0) return 0.0
        if (durSec <= t) return 0.0
        if (durSec <= ATTACK) return gain
        return if (t < ATTACK) {
            FLOOR * (gain / FLOOR).pow(t / ATTACK)
        } else {
            gain * (FLOOR / gain).pow((t - ATTACK) / (durSec - ATTACK))
        }
    }

    private fun waveOf(p: Double): Double {
        val frac = p - floor(p)
        return when (wave) {
            WAVE_SINE -> sin(2.0 * PI * p)
            WAVE_SQUARE -> if (frac < 0.5) 1.0 else -1.0
            WAVE_TRIANGLE -> 4.0 * abs(frac - 0.5) - 1.0
            WAVE_SAW -> 2.0 * frac - 1.0
            else -> 0.0
        }
    }

    private fun nextNoise(): Double {
        var x = noiseState
        x = x xor (x shl 13)
        x = x xor (x ushr 17)
        x = x xor (x shl 5)
        noiseState = x
        return x / 2147483648.0
    }
}

const val KIND_TONE = 0
const val KIND_NOISE = 1

/** 一段靜態音效定義（相對秒數），啟動時組裝成 [Voice] */
class Op(
    val at: Double,
    val dur: Double,
    val freq: Double,
    val slideTo: Double,
    val wave: Int,
    val gain: Double,
    val hp: Double,
    val bus: Double,
    val noise: Boolean
)

fun toneOp(
    at: Double, freq: Double, dur: Double, wave: Int, gain: Double,
    slideTo: Double = 0.0, bus: Double = BUS_SFX
): Op = Op(at, dur, freq, slideTo, wave, gain, 0.0, bus, false)

fun noiseOp(at: Double, dur: Double, gain: Double, hp: Double, bus: Double = BUS_SFX): Op =
    Op(at, dur, 0.0, 0.0, 0, gain, hp, bus, true)

fun Op.toVoice(base: Long): Voice {
    val start = base + (at * SAMPLE_RATE).toLong()
    val durSamples = (dur * SAMPLE_RATE).toInt().coerceAtLeast(1)
    return if (noise) {
        Voice(start, durSamples, KIND_NOISE, 0.0, 0.0, 0, gain, hp, bus)
    } else {
        Voice(start, durSamples, KIND_TONE, freq, slideTo, wave, gain, 0.0, bus)
    }
}
