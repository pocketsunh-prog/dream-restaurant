package com.dreamrestaurant.data

/** 資料契約見 docs/ARCHITECTURE.md §2（與網頁版逐欄對齊） */

data class Dish(
    val id: String,
    val name: String,
    val category: String,
    val baseCost: Int,
    val expectedPrice: Int,
    val unlockStars: Int,
    val secret: Boolean,
    val tags: List<String>,
    val cookTimeDefault: Int,
    val portionDefault: Int,
    val tasteDefault: Int,
    val gradeDefault: Int,
    val popularity: Map<String, Double>,
    val desc: String
)

data class Portrait(val hair: String, val skin: String, val shirt: String, val hat: Int)

data class StaffDef(
    val id: String,
    val name: String,
    val role: String,
    val age: Int,
    val gender: String,
    val speed: Int,
    val skill: Int,
    val stamina: Int,
    val wage: Int,
    val initWage: Int,
    val specialty: String,
    val personality: String,
    val desc: String,
    val portrait: Portrait
)

data class LocationDef(
    val id: String,
    val name: String,
    val city: String,
    val starsRequired: Int,
    val rentPerDay: Int,
    val baseTraffic: Double,
    val moveCost: Int,
    val gridW: Int,
    val gridH: Int,
    val customerMix: Map<String, Double>,
    val tastePrefs: List<String>,
    val weatherWeights: Map<String, Double>,
    val decorStyle: String,
    val skyline: String,
    val palette: Map<String, String>,
    val desc: String
)

data class FurnitureDef(
    val id: String,
    val name: String,
    val category: String,
    val w: Int,
    val h: Int,
    val price: Int,
    val seats: Int,
    val seatFacing: List<String>,
    val decorScore: Int,
    val style: String,
    val blocks: Boolean,
    val needsAdjacentFloor: Boolean,
    val durability: Int,
    val desc: String
)

data class EventEffects(
    val fame: Int = 0,
    val repCommunity: Int = 0,
    val repOutside: Int = 0,
    val moodAll: Int = 0,
    val trafficMul: Double = 1.0,
    val trafficMulMinutes: Int = 0,
    val cash: Int = 0,
    val supplierPriceMul: Double = 1.0,
    val stockLoss: Double = 0.0,
    val damage: String? = null
)

data class EventDef(
    val id: String,
    val name: String,
    val kind: String,
    val weight: Int,
    val minStars: Int,
    val maxStars: Int,
    val locations: List<String>?,
    val onlyWhileOpen: Boolean,
    val mitigateBy: List<String>?,
    val message: String,
    val log: String,
    val effects: EventEffects
)
