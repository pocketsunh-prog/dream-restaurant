package com.dreamrestaurant.sim

import com.dreamrestaurant.core.B
import com.dreamrestaurant.core.GameState
import com.dreamrestaurant.core.MagBoard
import com.dreamrestaurant.core.MagEntry
import com.dreamrestaurant.core.Rng
import com.dreamrestaurant.core.WeeklyRecord
import com.dreamrestaurant.core.pushLog
import com.dreamrestaurant.data.getLocation
import kotlin.math.ceil
import kotlin.math.max
import com.dreamrestaurant.core.round

/** 對應 src/sim/magazine.js —— 每週日 22:00 的雜誌五榜排名 */

private val RIVAL_NAMES = listOf(
    "阿坤快炒", "三姊妹小吃", "廟口海鮮樓", "小胖牛排館", "幸福食堂", "夜貓子食堂",
    "東方明珠餐廳", "阿婆乾麵", "好朋友簡餐", "廟東蚵仔煎", "老地方牛肉麵", "金太陽西餐廳",
    "小巷咖啡", "大胃王食堂", "海派熱炒", "阿美便當", "檳榔樹下小吃", "夜市王炸雞",
    "福氣小館", "八八食堂", "彩虹義大利麵", "嘟嘟牛排", "好味道麵店", "金牌快炒",
    "香蕉新樂園", "阿忠海產", "小南碗粿", "雙囍樓"
)

fun weekNumber(day: Int): Int = ceil(day / 7.0).toInt()

fun formatMoney(v: Int): String = String.format("%,d", v)

private fun recordsForWeek(state: GameState, week: Int): List<com.dreamrestaurant.core.DailyRecord> {
    val start = (week - 1) * 7 + 1
    val end = week * 7
    val rows = state.stats.history.filter { it.day >= start && it.day <= end }
    if (rows.isNotEmpty()) return rows
    return state.stats.history.takeLast(7)
}

class Scores(
    val taste: Double, val service: Double, val decor: Double, val price: Double,
    val popularity: Double, val guests: Int, val served: Int, val angry: Int,
    val avgWaitMin: Double
)

/** 本週五項分數（0 ～ 100） */
fun computeScores(state: GameState, rows: List<com.dreamrestaurant.core.DailyRecord>): Scores {
    val loc = getLocation(state.locationId)
    val guests = rows.sumOf { it.guests }
    val served = rows.sumOf { it.served }
    val angry = rows.sumOf { it.angry }
    val avgWaitMin = if (rows.isNotEmpty()) rows.sumOf { it.avgWaitSec } / rows.size / 60.0 else 30.0
    val decor = if (rows.isNotEmpty()) rows[rows.size - 1].decor else 0
    val dishScores = rows.map { it.dishScoreAvg }.filter { it > 0 }
    val valueScores = rows.map { it.valueScoreAvg }.filter { it > 0 }

    val tasteRaw = avgOf(dishScores)
    val taste = clamp(if (tasteRaw == 0.0) 45.0 else tasteRaw, 0.0, 100.0)
    val angryRate = if (guests > 0) angry / max(1, guests).toDouble() else 0.0
    val waitPenalty = clamp((avgWaitMin / 45.0) * 35, 0.0, 45.0)
    val angryPenalty = clamp(angryRate * 85, 0.0, 45.0)
    val service = clamp(100 - waitPenalty - angryPenalty, 0.0, 100.0)
    val decorScore = clamp(decor / 5.0, 0.0, 100.0)
    val valueRaw = avgOf(valueScores)
    val price = clamp((if (valueRaw == 0.0) 0.8 else valueRaw) * 71, 0.0, 100.0)
    val targetGuests = 7.0 * (loc?.baseTraffic ?: 1.0) * 130
    val popularity = clamp((guests / max(40.0, targetGuests)) * 70 + state.stars * 3, 0.0, 100.0)

    return Scores(taste, service, decorScore, price, popularity, guests, served, angry, avgWaitMin)
}

/**
 * 執行週結算。回傳 weekly 記錄；同時更新 state.stats.magazine。
 */
fun runWeeklySettlement(state: GameState, rng: Rng): WeeklyRecord {
    val week = weekNumber(state.day)
    val rows = recordsForWeek(state, week)
    val scores = computeScores(state, rows)
    val rivalBase = 52 + week * 0.7

    val rank = LinkedHashMap<String, MagBoard>()
    val categoryRanks = mutableListOf<Int>()

    for ((catId, catName) in B.MAG_CATEGORIES) {
        val playerScore = clamp(scoresByKey(scores, catId), 0.0, 100.0)
        val names = rng.shuffle(RIVAL_NAMES).take(B.MAG_RIVALS)
        val rivals = names.map { name ->
            val s = clamp(rivalBase + rng.range(-16.0, 16.0), 15.0, 100.0)
            MagEntry(name, round(s * 10) / 10)
        }
        val ahead = rivals.count { it.score > playerScore }
        val myRank = ahead + 1
        val topList = (rivals + MagEntry("本店", round(playerScore * 10) / 10, me = true))
            .sortedByDescending { it.score }
            .take(6)
            .mapIndexed { i, e -> MagEntry(e.name, e.score, e.me, i + 1) }
            .toMutableList()
        rank[catId] = MagBoard(myRank, round(playerScore * 10) / 10, topList, catName)
        categoryRanks.add(myRank)
    }

    val playerAvg = B.MAG_CATEGORIES.sumOf { rank[it.first]?.score ?: 0.0 } / B.MAG_CATEGORIES.size
    val totalNames = rng.shuffle(RIVAL_NAMES).take(B.MAG_RIVALS)
    val totalRivals = totalNames.map { name ->
        val s = clamp(rivalBase + rng.range(-13.0, 13.0), 15.0, 100.0)
        MagEntry(name, round(s * 10) / 10)
    }
    val totalAhead = totalRivals.count { it.score > playerAvg }
    val totalRank = totalAhead + 1
    val totalTop = (totalRivals + MagEntry("本店", round(playerAvg * 10) / 10, me = true))
        .sortedByDescending { it.score }
        .take(8)
        .mapIndexed { i, e -> MagEntry(e.name, e.score, e.me, i + 1) }
        .toMutableList()
    rank["total"] = MagBoard(totalRank, round(playerAvg * 10) / 10, totalTop, "總排名")

    val mag = state.stats.magazine
    mag.rank = rank
    mag.lastSettleDay = state.day
    mag.lastTotalRank = totalRank
    mag.bestTotalRank = if (mag.bestTotalRank == null) totalRank else minOf(mag.bestTotalRank!!, totalRank)
    if (totalRank == 1) mag.firstPlaceWeeks += 1

    val fameGain = clamp((21 - totalRank) * 0.28, -2.0, 6.0)
    state.fame = clamp(state.fame + fameGain, 0.0, 100.0)
    var prize = 0
    when {
        totalRank == 1 -> prize = 150000
        totalRank <= 3 -> prize = 60000
        totalRank <= 8 -> prize = 20000
    }
    if (prize != 0) {
        state.cash += prize
        state.stats.today.revenue += prize
    }

    val scoreMap = linkedMapOf(
        "taste" to round(scores.taste * 10) / 10,
        "service" to round(scores.service * 10) / 10,
        "decor" to round(scores.decor * 10) / 10,
        "price" to round(scores.price * 10) / 10,
        "popularity" to round(scores.popularity * 10) / 10
    )
    val rankMap = B.MAG_CATEGORIES.associate { it.first to (rank[it.first]?.rank ?: 0) }.toMutableMap()

    val weekly = WeeklyRecord(
        week = week,
        startDay = (week - 1) * 7 + 1,
        endDay = week * 7,
        revenue = rows.sumOf { it.revenue },
        profit = rows.sumOf { it.profit },
        guests = scores.guests,
        served = scores.served,
        angry = scores.angry,
        scores = scoreMap,
        ranks = rankMap,
        totalRank = totalRank,
        prize = prize,
        repCommunity = round(state.reputation.community * 10) / 10,
        repOutside = round(state.reputation.outside * 10) / 10,
        stars = state.stars,
        topList = totalTop
    )
    state.stats.weekly.add(weekly)
    val prizeText = if (prize != 0) "，獲得獎金 NT$ ${formatMoney(prize)}" else ""
    pushLog(
        state,
        "第 ${week} 週雜誌結算：總排名第 ${totalRank} 名$prizeText",
        if (totalRank <= 8) "good" else "info"
    )
    return weekly
}

private fun scoresByKey(s: Scores, id: String): Double = when (id) {
    "taste" -> s.taste
    "service" -> s.service
    "decor" -> s.decor
    "price" -> s.price
    "popularity" -> s.popularity
    else -> 0.0
}

fun weeklyBonus(state: GameState): Int {
    state.cash += B.WEEKLY_BONUS
    state.stats.today.revenue += B.WEEKLY_BONUS
    val msg = "社區獎金 NT$ ${formatMoney(B.WEEKLY_BONUS)} 入帳"
    pushLog(state, msg, "good")
    state.uiQueue.add(com.dreamrestaurant.core.UiMsg(type = "toast", message = msg, kind = "good"))
    return B.WEEKLY_BONUS
}
