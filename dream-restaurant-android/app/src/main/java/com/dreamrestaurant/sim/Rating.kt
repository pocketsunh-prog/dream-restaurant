package com.dreamrestaurant.sim

import com.dreamrestaurant.core.B
import com.dreamrestaurant.core.Customer
import com.dreamrestaurant.core.DailyRecord
import com.dreamrestaurant.core.GameState
import com.dreamrestaurant.core.Rng
import com.dreamrestaurant.core.pushLog
import com.dreamrestaurant.core.syncMenuLimitNote
import com.dreamrestaurant.data.locationsForStars
import com.dreamrestaurant.core.round

/** 對應 src/sim/rating.js —— 社區／區外雙桶評價、知名度、星級判定 */

class MoodApply(val bucket: String, val delta: Double)

/** 一次顧客離場對評價的影響 */
fun applyCustomerMood(state: GameState, customer: Customer): MoodApply {
    val bucket = customerBucket(state, customer)
    val weight = B.TYPE_WEIGHT[customer.type] ?: 1.0
    val m = clamp(customer.mood, -100.0, 100.0)
    var delta = (if (m >= 0) (m / 100.0) * 0.4 else (m / 100.0) * 0.25) * weight
    if (customer.leftAngry) delta -= 0.45 * weight
    if (customer.wasCritic && customer.mood > 30) delta += 0.4
    if (customer.type == "cherish" && customer.mood > 20) delta += 0.25
    if (bucket == "outside") delta *= 1.45
    delta *= (customer.partyVoice ?: 1.0)
    addRating(state, bucket, delta)
    return MoodApply(bucket, delta)
}

fun customerBucket(state: GameState, customer: Customer): String {
    if (customer.type == "critic" || customer.type == "vip" || customer.type == "tourist") return "outside"
    return if (customer.outsideRoll) "outside" else "community"
}

fun addRating(state: GameState, bucket: String, delta: Double) {
    if (bucket == "outside") {
        state.reputation.outside = clamp(state.reputation.outside + delta, B.RATING_MIN.toDouble(), B.RATING_MAX.toDouble())
    } else {
        state.reputation.community = clamp(state.reputation.community + delta, B.RATING_MIN.toDouble(), B.RATING_MAX.toDouble())
    }
}

/** 每日知名度變化：由星級與評價推向目標值，事件會直接加減 */
fun dailyFame(state: GameState, record: DailyRecord?) {
    val target = clamp(
        3 + state.stars * 7 + (state.reputation.community - 350) / 9.0 + (state.reputation.outside - 350) / 14.0,
        0.0, 100.0
    )
    val pull = (target - state.fame) * 0.07
    val moodPush = if (record != null) ((record.avgMood) - 50) / 50.0 * 0.5 else 0.0
    state.fame = clamp(state.fame + pull + moodPush, 0.0, 100.0)
}

/** 建立顧客時擲一次「是否算區外客」 */
fun rollOutside(state: GameState, rng: Rng): Boolean = rng.chance(0.33)

class NumBar(var have: Double, var need: Double?, var ok: Boolean)
class IntBar(var have: Int, var need: Int?, var ok: Boolean)

class StarProgress(
    val nextStar: Int?,
    val community: NumBar,
    val outside: NumBar,
    val days: IntBar,
    val rank: IntBar?,
    val bestRank1: IntBar?,
    val firstTwice: IntBar?,
    val firstThrice: IntBar?,
    val text: String
)

fun starProgress(state: GameState): StarProgress {
    val cur = kotlin.math.min(B.MAX_STARS, kotlin.math.max(1, round(state.stars.toDouble()).toInt()))
    val nextStar = kotlin.math.min(B.MAX_STARS, cur + 1)
    if (cur >= B.MAX_STARS) {
        return StarProgress(
            nextStar = null,
            community = NumBar(state.reputation.community, null, true),
            outside = NumBar(state.reputation.outside, null, true),
            days = IntBar(state.day, null, true),
            rank = null, bestRank1 = null, firstTwice = null, firstThrice = null,
            text = "已達 ${B.MAX_STARS} 星，挑戰年度大獎"
        )
    }
    val req = B.STAR_REQS[nextStar]
    val rank = state.stats.magazine.lastTotalRank
    return StarProgress(
        nextStar = nextStar,
        community = NumBar(
            state.reputation.community, req.community.toDouble(),
            state.reputation.community >= req.community
        ),
        outside = NumBar(
            state.reputation.outside, req.outside.toDouble(),
            state.reputation.outside >= req.outside
        ),
        days = IntBar(state.day, req.days.takeIf { it > 0 }, state.day >= req.days),
        rank = if (req.rank != null) {
            IntBar(rank ?: Int.MAX_VALUE, req.rank, rank != null && rank <= req.rank!!)
        } else null,
        bestRank1 = if (req.bestRank1) {
            IntBar(state.stats.magazine.bestTotalRank ?: 0, null, state.stats.magazine.bestTotalRank == 1)
        } else null,
        firstTwice = if (req.firstTwice) {
            IntBar(state.stats.magazine.firstPlaceWeeks, 2, state.stats.magazine.firstPlaceWeeks >= 2)
        } else null,
        firstThrice = if (req.firstThrice) {
            IntBar(state.stats.magazine.firstPlaceWeeks, 3, state.stats.magazine.firstPlaceWeeks >= 3)
        } else null,
        text = req.text
    )
}

class StarUp(val from: Int, val to: Int)

/**
 * 每日檢查升星。回傳 {from,to} 或 null。
 * 原作需要兩個評價桶都達標，這是玩家最常卡關的地方。
 */
fun checkStars(state: GameState): StarUp? {
    if (state.stars >= B.MAX_STARS) return null
    val p = starProgress(state)
    val next = p.nextStar ?: return null
    val req = B.STAR_REQS.getOrNull(next) ?: return null
    if (!p.community.ok || !p.outside.ok) return null
    if (req.days > 0 && state.day < req.days) return null
    if (req.rank != null) {
        val rank = state.stats.magazine.lastTotalRank
        if (rank == null || rank > req.rank) return null
    }
    if (req.bestRank1 && state.stats.magazine.bestTotalRank != 1) return null
    if (req.firstTwice && state.stats.magazine.firstPlaceWeeks < 2) return null
    if (req.firstThrice && state.stats.magazine.firstPlaceWeeks < 3) return null

    val from = state.stars
    state.stars = next
    state.flags.starHistory.add(state.stars)
    if (state.flags.annualStartDay == 0) state.flags.annualStartDay = state.day
    syncMenuLimitNote(state)

    val newLocations = locationsForStars(state.stars).filter { it.starsRequired > from }
    val names = newLocations.joinToString("、") { it.name }
    pushLog(state, "升上 ${state.stars} 星！解鎖 ${names.ifEmpty { "新料理" }}", "good")
    state.uiQueue.add(
        com.dreamrestaurant.core.UiMsg(
            type = "starUp", from = from, to = state.stars,
            locations = newLocations.map { it.id }.toMutableList()
        )
    )
    return StarUp(from, state.stars)
}

class StarDrop(val from: Int, val to: Int)

/** 連續三週評價低於門檻 → 掉星 */
fun checkDropStar(state: GameState): StarDrop? {
    if (state.stars <= 1) return null
    val req = B.STAR_REQS.getOrNull(state.stars) ?: return null
    val floorC = req.community - 50
    val floorO = req.outside - 50
    if (state.reputation.community < floorC || state.reputation.outside < floorO) {
        state.flags.warnedWeek += 1
        if (state.flags.warnedWeek >= 3) {
            state.flags.warnedWeek = 0
            val from = state.stars
            state.stars -= 1
            syncMenuLimitNote(state)
            pushLog(state, "評價長期低迷，雜誌把星級降回 ${state.stars} 星…", "bad")
            state.uiQueue.add(
                com.dreamrestaurant.core.UiMsg(
                    type = "toast",
                    message = "星級被降為 ${state.stars} 星，趕快改善評價！", kind = "bad"
                )
            )
            return StarDrop(from, state.stars)
        }
        state.uiQueue.add(
            com.dreamrestaurant.core.UiMsg(
                type = "toast",
                message = "警告：評價低於 ${state.stars} 星門檻（${state.flags.warnedWeek}/3 週）",
                kind = "bad"
            )
        )
        return null
    }
    state.flags.warnedWeek = 0
    return null
}

/** 年度大獎判定：五星後再撐滿 120 天，且年度總排名第一 */
fun checkAnnualAward(state: GameState): Boolean {
    if (state.flags.annualAward || state.stars < 5) return false
    val start = state.flags.annualStartDay
    if (start == 0) return false
    if (state.day - start < 120) return false
    val rank = state.stats.magazine.lastTotalRank
    if (rank != 1) return false
    state.flags.annualAward = true
    state.flags.secretUnlocked = true
    pushLog(state, "榮獲年度大獎 The Greatest Restaurant of the Year！解鎖隱藏料理", "good")
    state.uiQueue.add(com.dreamrestaurant.core.UiMsg(type = "annualAward"))
    return true
}
