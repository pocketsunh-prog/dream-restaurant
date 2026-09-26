package com.dreamrestaurant.core

import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/** 所有可調數值 —— 對應 src/core/balance.js */
object B {
    const val TILE_W = 64
    const val TILE_H = 32
    const val GRID_W = 26
    const val GRID_H = 17

    const val MINUTES_PER_DAY = 1440
    const val MINUTES_PER_SECOND = 1
    val SPEEDS = listOf(0, 1, 2, 4)
    const val SETTLE_MINUTE = 22 * 60
    const val WEEKLY_BONUS = 20000000
    const val CLOSING_SOON_MIN = 30
    const val START_CASH = 90000000
    const val BANKRUPT_DAYS = 7

    const val MAX_STARS = 7

    val STAR_REQS: List<StarReq> = listOf(
        StarReq(0, 0, 0, 0, null, false, false, false, ""),
        StarReq(1, 0, 0, 0, null, false, false, false, "開業即可"),
        StarReq(2, 380, 360, 7, null, false, false, false, "營業滿 7 天"),
        StarReq(3, 410, 385, 14, 8, false, false, false, "週排名進前 8 名"),
        StarReq(4, 435, 410, 21, 3, true, false, false, "週排名進前 3 名且曾拿第一"),
        StarReq(5, 460, 435, 35, 1, true, true, false, "連兩週雜誌總排名第一"),
        StarReq(6, 485, 460, 50, 2, true, true, false, "營業滿 50 天、連兩週第一，且本週排名仍在前 2 名"),
        StarReq(7, 495, 490, 65, 1, true, true, true, "連三週雜誌總排名第一（全台第一的傳說小店）")
    )

    const val MOVE_OUTSIDE_PENALTY = 45
    const val RATING_MIN = 0
    const val RATING_MAX = 500
    const val RATING_START = 350

    val PATIENCE = mapOf(
        "student" to intArrayOf(78, 118),
        "office" to intArrayOf(56, 84),
        "family" to intArrayOf(70, 105),
        "tourist" to intArrayOf(62, 96),
        "critic" to intArrayOf(59, 86),
        "vip" to intArrayOf(51, 74),
        "cherish" to intArrayOf(82, 124)
    )

    const val COOK_TIME_SCALE = 0.32
    const val CHEF_POTS = 3

    val TYPE_WEIGHT = mapOf(
        "student" to 0.8, "office" to 1.0, "family" to 1.1, "tourist" to 1.25, "critic" to 5.0,
        "vip" to 3.0, "couple" to 1.1, "colleagues" to 1.2, "tour_group" to 1.4, "soldiers" to 1.0,
        "regulars" to 1.6, "blogger" to 3.5, "cyclists" to 0.9, "elderly" to 1.2, "kids_party" to 1.1
    )

    val TYPE_SPEND = mapOf(
        "student" to 0.85, "office" to 1.0, "family" to 1.25, "tourist" to 1.15, "critic" to 1.0,
        "vip" to 1.6, "couple" to 1.25, "colleagues" to 1.15, "tour_group" to 1.05, "soldiers" to 1.2,
        "regulars" to 1.1, "blogger" to 1.0, "cyclists" to 0.95, "elderly" to 1.1, "kids_party" to 1.0
    )

    val CUSTOMER_TYPES = listOf(
        CustomerType("student", "學生", 1, 3, listOf("cheap", "fried", "quick", "rice", "noodle", "meat"), 68, "local"),
        CustomerType("office", "上班族", 1, 2, listOf("quick", "rice", "noodle", "caffeine", "mild"), 52, "local"),
        CustomerType("family", "家庭客", 3, 6, listOf("meat", "soup", "rice", "local"), 58, "local"),
        CustomerType("couple", "情侶", 2, 2, listOf("sweet", "premium", "dessert", "drink"), 62, "local"),
        CustomerType("colleagues", "同事聚餐", 4, 6, listOf("meat", "alcohol", "fried", "rice"), 60, "local"),
        CustomerType("regulars", "老主顧", 2, 3, listOf("local", "rice", "soup", "cheap"), 55, "local"),
        CustomerType("kids_party", "親子團", 3, 7, listOf("sweet", "fried", "drink", "dessert"), 60, "local"),
        CustomerType("elderly", "銀髮族", 2, 4, listOf("mild", "soup", "veg", "local"), 45, "local"),
        CustomerType("soldiers", "阿兵哥", 3, 5, listOf("meat", "rice", "cheap", "fried"), 70, "local"),
        CustomerType("cyclists", "單車族", 2, 4, listOf("quick", "cold", "drink", "cheap"), 55, "local"),
        CustomerType("tourist", "觀光客", 2, 5, listOf("local", "tourist", "seafood", "fried"), 62, "outside"),
        CustomerType("tour_group", "旅行團", 5, 8, listOf("local", "tourist", "rice", "soup"), 60, "outside"),
        CustomerType("critic", "美食評論家", 1, 2, listOf("premium", "seafood", "soup", "local"), 55, "outside"),
        CustomerType("blogger", "美食部落客", 1, 2, listOf("premium", "sweet", "dessert", "tourist"), 58, "outside"),
        CustomerType("vip", "貴賓", 2, 4, listOf("premium", "seafood", "meat"), 50, "outside"),
        CustomerType("cherish", "Cherish", 1, 1, listOf("sweet", "dessert", "caffeine", "premium"), 72, "local")
    )

    val CUSTOMER_TYPE_MAP: Map<String, CustomerType> = CUSTOMER_TYPES.associateBy { it.id }

    val TYPE_BASE_WEIGHT = mapOf(
        "student" to 22.0, "office" to 16.0, "family" to 14.0, "couple" to 9.0, "colleagues" to 7.0,
        "regulars" to 6.0, "kids_party" to 5.0, "elderly" to 5.0, "soldiers" to 3.0, "cyclists" to 4.0,
        "tourist" to 10.0, "tour_group" to 2.5, "critic" to 1.2, "blogger" to 1.6, "vip" to 1.2,
        "cherish" to 1.8
    )

    const val PARTY_PAY_FACTOR = 0.8
    const val EATING_PER_GUEST = 1.0
    const val PARTY_PATIENCE_BONUS = 0.03

    const val KITCHEN_MAX_LEVEL = 5

    val KITCHEN_SPECS = mapOf(
        "stove" to KitchenSpec("stove", "爐具", "🔥", 18000, 1.9) { l -> "煮菜速度 +${l * 7}%（現在 ${((1 - (1 - 0.93.pow(l - 1)) * 100)).roundToInt()}% 加速）" },
        "fridge" to KitchenSpec("fridge", "冰箱", "❄", 15000, 1.85) { l -> "食材折損 -${l * 18}%（現在剩 ${max(10, 100 - l * 18)}%）" },
        "prep" to KitchenSpec("prep", "流理台", "🔪", 12000, 1.8) { l -> "每位廚師多顧 ${l - 1} 個鍋（總鍋數 = 廚師 × ${2 + l - 1}）" }
    )

    const val QUEUE_STEP = 1.05

    const val MOOD_ANGRY_LEAVE = -55
    const val MOOD_COMPLAIN = -20
    const val MOOD_HAPPY = 45
    const val MOOD_MAX_TIP = 0.12

    const val EATING_MIN = 12
    const val EATING_PER_PORTION = 6

    const val COMFORT_MIN = 22
    const val COMFORT_MAX = 26
    val WEATHER_COMFORT_SHIFT = mapOf(
        "sunny" to 0, "cloudy" to 0, "rain" to 1, "storm" to 2, "cold" to 4, "heat" to -4
    )

    const val UTILITY_BASE = 320
    const val UTILITY_PER_DEGREE = 26
    const val CLEAN_FLOOR_COST = 4000
    const val CLEAN_RESTROOM_COST = 1500
    const val CLEAN_FLOOR_PER_MIN = 0.06
    const val DIRT_PER_GUEST = 0.9
    const val RESTROOM_DIRT_PER_GUEST = 1.6
    const val DIRT_COMPLAIN = 60.0
    const val DIRT_BAD = 78.0

    const val DELIVERY_MINUTES = 12
    const val PERISHABLE_LOSS = 0.10
    val PERISHABLE_CATEGORIES = listOf("staple", "side", "soup")

    const val SEVERANCE_HOURS = 8
    const val MIN_WAGE = 1
    const val MAX_WAGE = 60
    const val FATIGUE_PER_HOUR = 3.0
    const val FATIGUE_RECOVER_PER_HOUR = 8.0
    const val FATIGUE_REST_PER_DAY = 45.0
    const val FATIGUE_TIRED = 65.0
    const val MOOD_QUIT = 22.0
    const val MOOD_LOW = 38.0

    val MAG_CATEGORIES = listOf(
        "taste" to "口味", "service" to "服務", "decor" to "裝潢", "price" to "價格", "popularity" to "人氣"
    )
    const val MAG_RIVALS = 19

    const val LURE_PER_CLICK = 0.005
    const val LURE_MAX = 0.30
    const val LURE_HALF_LIFE_MIN = 20.0

    val MENU_LIMIT = mapOf(1 to 8, 2 to 14, 3 to 22, 4 to 34, 5 to 99, 6 to 99, 7 to 99)

    const val WALK_TILES_PER_MIN = 4.2

    fun hourFactor(minute: Double): Double {
        val h = minute / 60.0
        return when {
            h < 6 -> 0.15
            h < 9 -> 0.45
            h < 11 -> 1.8
            h < 14 -> 3.6
            h < 17 -> 1.8
            h < 21 -> 3.8
            h < 23 -> 1.0
            else -> 0.4
        }
    }

    val WEATHER_TRAFFIC = mapOf(
        "sunny" to 2.15, "cloudy" to 2.0, "rain" to 1.72, "storm" to 1.5, "cold" to 1.82, "heat" to 1.9
    )

    val WEATHER_NAME = mapOf(
        "sunny" to "晴天", "cloudy" to "陰天", "rain" to "下雨", "storm" to "豪雨", "cold" to "寒流", "heat" to "熱浪"
    )

    val MUSIC_NAME = mapOf(
        "lazy" to "慵懶", "tropical" to "南國風", "classic1" to "古典樂一", "classic2" to "古典樂二",
        "pop" to "流行", "off" to "關閉"
    )

    val MUSIC_APPEAL = mapOf(
        "lazy" to mapOf("student" to 0.3, "family" to 0.6, "office" to 0.4, "tourist" to 0.4, "critic" to 0.5, "vip" to 0.3),
        "tropical" to mapOf("student" to 0.4, "family" to 0.5, "office" to 0.2, "tourist" to 0.8, "critic" to 0.4, "vip" to 0.4),
        "classic1" to mapOf("student" to 0.1, "family" to 0.4, "office" to 0.5, "tourist" to 0.3, "critic" to 0.9, "vip" to 0.9),
        "classic2" to mapOf("student" to 0.1, "family" to 0.4, "office" to 0.5, "tourist" to 0.3, "critic" to 0.9, "vip" to 0.8),
        "pop" to mapOf("student" to 0.9, "family" to 0.3, "office" to 0.3, "tourist" to 0.5, "critic" to 0.2, "vip" to 0.4),
        "off" to mapOf("student" to 0.2, "family" to 0.3, "office" to 0.3, "tourist" to 0.2, "critic" to 0.1, "vip" to 0.1)
    )

    fun kitchenUpgradeCost(target: String, currentLevel: Int): Double {
        val spec = KITCHEN_SPECS[target] ?: return Double.POSITIVE_INFINITY
        return (spec.base * spec.mult.pow(currentLevel - 1)).roundToInt().toDouble()
    }

    fun kitchenStoveMultiplier(level: Int): Double = max(0.6, 0.93.pow(level - 1))
    fun kitchenFridgeMultiplier(level: Int): Double = max(0.15, 1 - (level - 1) * 0.18)
    fun kitchenPrepPots(level: Int): Int = 2 + (level - 1)
}

data class StarReq(
    val star: Int, val community: Int, val outside: Int, val days: Int, val rank: Int?,
    val bestRank1: Boolean, val firstTwice: Boolean, val firstThrice: Boolean, val text: String
)

data class CustomerType(
    val id: String, val name: String, val partyMin: Int, val partyMax: Int,
    val tags: List<String>, val taste: Int, val bucket: String
)

data class KitchenSpec(
    val id: String, val name: String, val icon: String, val base: Int, val mult: Double,
    val desc: (Int) -> String
)
