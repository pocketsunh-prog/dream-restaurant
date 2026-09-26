package com.dreamrestaurant

import com.dreamrestaurant.core.GameAction
import com.dreamrestaurant.core.createNewGame
import com.dreamrestaurant.core.reduce
import com.dreamrestaurant.data.dishesForStars
import com.dreamrestaurant.sim.availability
import com.dreamrestaurant.sim.spawnRate
import com.dreamrestaurant.sim.stepSimulation
import org.junit.Test

class DebugDayTest {
    @Test
    fun dump() {
        val state = createNewGame(20240101)
        val extra = dishesForStars(state.stars)
            .filter { d -> state.menu.none { it.dishId == d.id } }.take(4)
        for (d in extra) reduce(state, GameAction.MenuAdd(d.id))
        for ((x, y) in listOf(3 to 10, 20 to 10)) {
            reduce(state, GameAction.PlaceFurniture("table_2a", x, y))
        }
        for (cand in state.candidates.take(3)) {
            val r = reduce(state, GameAction.Hire(cand.candidateId))
            if (!r.ok) break
        }
        for (st in state.staff) {
            reduce(state, GameAction.SetShift(st.uid, 600, 1380))
            reduce(state, GameAction.SetDuty(st.uid, "cleanFloor", true))
            reduce(state, GameAction.SetDuty(st.uid, "cleanRestroom", true))
        }
        reduce(state, GameAction.SetDuty(state.staff[0].uid, "cashier", true))
        val open = reduce(state, GameAction.StartDay)
        println("open = ok=${open.ok} err=${open.error} info=${open.info}")
        println("ROUNDTEST r16.5=${kotlin.math.round(16.5)} r17.5=${kotlin.math.round(17.5)} r12.5=${kotlin.math.round(12.5)} r15.5=${kotlin.math.round(15.5)}")

        fun cntSorted(list: List<String>): String {
            val m = sortedMapOf<String, Int>()
            for (v in list) m[v] = (m[v] ?: 0) + 1
            return m.entries.joinToString(",") { "${it.key}:${it.value}" }
        }

        fun jnum(v: Double): String =
            if (v.isFinite() && v == kotlin.math.floor(v) && kotlin.math.abs(v) < 1e15) v.toLong().toString()
            else v.toString()

        fun f3(v: Double): String = String.format(java.util.Locale.US, "%.3f", v)

        fun dump(tag: String) {
            val cust = mutableMapOf<String, Int>()
            for (c in state.sim.customers) cust[c.state] = (cust[c.state] ?: 0) + 1
            val tasks = mutableMapOf<String, Int>()
            for (t in state.sim.tasks) {
                val k = t.kind + (t.stage?.let { ":$it" } ?: "")
                tasks[k] = (tasks[k] ?: 0) + 1
            }
            val staff = mutableMapOf<String, Int>()
            for (s in state.staff) {
                val k = s.role + ":" + s.state + (s.task?.let { ":$it" } ?: "")
                staff[k] = (staff[k] ?: 0) + 1
            }
            val custS = cntSorted(state.sim.customers.map { it.state })
            val taskS = cntSorted(state.sim.tasks.map { it.kind + (it.stage?.let { ":$it" } ?: "") })
            val tids = state.sim.tasks.joinToString(",") { "${it.id}:${it.kind}:${it.stage ?: "-"}:${it.claimedBy ?: "-"}" }
            val staffS = state.staff.joinToString(" ") {
                "${it.role}/${it.state}/${it.task ?: "-"}/${jnum(it.x)},${jnum(it.y)}/${it.pathIndex}/${it.path.size}/${it.working}"
            }
            val custD = state.sim.customers.joinToString(" ") {
                "${it.state}/${f3(it.x)},${f3(it.y)}/${it.pathIndex}/${it.path.size}/${it.tableUid ?: "-"}" +
                    "/${it.queueTarget?.let { q -> "${f3(q.x)},${f3(q.y)}" } ?: "-"}" +
                    "/${it.path.joinToString("|") { p -> "${jnum(p.x)},${jnum(p.y)}" }}"
            }
            val tt = state.stats.today
            val kitD = state.sim.kitchen.joinToString(",") {
                "${it.id}:${String.format(java.util.Locale.US, "%.4f", it.remaining)}:${it.customerUid}:${it.dishId}:${it.chefUid ?: "-"}"
            }
            val passD = state.sim.pass.joinToString(",") { "${it.id}:${it.customerUid}" }
            val chef = state.staff.filter { it.role == "chef" }
                .joinToString(";") { "sk${it.skill}|sm${String.format(java.util.Locale.US, "%.6f", it.speedMod)}|fat${String.format(java.util.Locale.US, "%.3f", it.fatigue)}|sp${it.speed}" }
            println(
                "T $tag cust=[$custS] task=[$taskS] kit=${state.sim.kitchen.size} pass=${state.sim.pass.size}" +
                    " kitD=[$kitD] passD=[$passD] chef=$chef" +
                    " staff=[$staffS] custD=[$custD] tids=[$tids]" +
                    " F rng=${state.rng} g=${tt.guests} s=${tt.served} a=${tt.angry} sp=${state.sim.customersSpawned}" +
                    " acc=${String.format(java.util.Locale.US, "%.6f", state.sim.spawnAccumulator)} evT=${jnum(state.sim.eventTimer)}"
            )
            println("[$tag] minute=${state.minute} phase=${state.phase}")
            println("  customers $cust")
            println("  tasks $tasks")
            println("  staff $staff")
            println("  kitchen ${state.sim.kitchen.size} pass ${state.sim.pass.size} stock ${state.menu.map { state.stock[it.dishId] ?: 0 }}")
            println("  tables " + state.sim.tables.joinToString(" ") { "${it.uid}:${it.state}:occ${it.occupants.size}:${if (it.usable) "U" else "-"}" })
            val t = state.stats.today
            println(
                "  flow guests=${t.guests} served=${t.served} angry=${t.angry} " +
                    "spawned=${state.sim.customersSpawned} spawnAcc=${state.sim.spawnAccumulator} " +
                    "rng=${state.rng} evT=${state.sim.eventTimer} traffic=${state.sim.trafficMul} " +
                    "walkers=${state.sim.walkers.size} repC=${state.reputation.community} " +
                    "repO=${state.reputation.outside} " +
                    "mood=${if (t.moodCount > 0) t.moodSum / t.moodCount else 0.0} wait=${t.waitCount}"
            )
            val av = availability(state)
            println(
                "  rate rate=${spawnRate(state)} free=${av.freeSeats} waiting=${av.waiting} " +
                    "fame=${state.fame} stars=${state.stars} dec=${t.decorations} " +
                    "weather=${state.sim.weather} traffic=${state.sim.trafficMul}"
            )
            println("  staff detail:")
            for (s in state.staff) {
                println("    ${s.name} ${s.role} st=${s.state} task=${s.task} xy=(${s.x},${s.y}) dir=${s.dir} path=${s.path.size}@${s.pathIndex} shift=${s.shift.start}-${s.shift.end} working=${s.working}")
            }
            val stuck = state.sim.customers.filter { it.state == "toSeat" }.take(3)
            for (c in stuck) {
                println("    cust ${c.uid} st=${c.state} xy=(${c.x},${c.y}) seat=${c.seat?.x},${c.seat?.y} table=${c.tableUid} path=${c.path.size}@${c.pathIndex} selfSeated=${c.selfSeated}")
            }
            state.sim.tasks.take(5).forEach {
                println("    task ${it.id} ${it.kind} table=${it.tableUid} cust=${it.customerUid} claimed=${it.claimedBy} stage=${it.stage}")
            }
        }

        dump("0m")
        for (i in 1..6) {
            stepSimulation(state, 5.0)
            dump("tick$i")
        }
        for ((mins, tag) in listOf(30 to "30m", 60 to "1h", 120 to "2h", 240 to "4h")) {
            while (state.minute < 11 * 60 + mins) stepSimulation(state, 5.0)
            dump(tag)
        }
    }
}
