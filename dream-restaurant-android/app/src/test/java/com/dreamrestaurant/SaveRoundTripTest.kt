package com.dreamrestaurant

import com.dreamrestaurant.core.GameAction
import com.dreamrestaurant.core.SaveManager
import com.dreamrestaurant.core.createNewGame
import com.dreamrestaurant.core.reduce
import com.dreamrestaurant.ui.FileSaveStorage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** 存讀檔往返（檔案式儲存） */
class SaveRoundTripTest {

    @Test
    fun saveThenLoadRestoresState() {
        val dir = File("build/tmp-save-${System.nanoTime()}")
        try {
            val mgr = SaveManager(FileSaveStorage(dir))
            val state = createNewGame(20240101)
            state.cash = 123456.0
            state.day = 7
            reduce(state, GameAction.PlaceFurniture("table_2a", 5, 5))

            val saved = mgr.save(state, "auto")
            assertTrue(saved.error ?: "ok", saved.ok)

            val slots = mgr.listSlots()
            val auto = slots.firstOrNull { it.slot == "auto" }
            assertTrue("沒有列出 auto 槽位", auto != null)
            assertEquals(7, auto!!.day)
            assertEquals(123456.0, auto.cash!!, 0.001)
            assertTrue(auto.savedAt != null)

            val res = mgr.load("auto")
            assertTrue(res.error ?: "ok", res.ok)
            val loaded = res.state!!
            assertEquals(7, loaded.day)
            assertEquals(123456.0, loaded.cash, 0.001)
            assertEquals(state.stars, loaded.stars)
            assertEquals(state.menu.map { it.dishId }, loaded.menu.map { it.dishId })
            assertEquals(state.staff.size, loaded.staff.size)
            assertEquals(state.layout.items.size, loaded.layout.items.size)
            assertEquals(state.layout.items.lastOrNull()?.typeId, loaded.layout.items.lastOrNull()?.typeId)
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test
    fun manualSlotsAreListed() {
        val dir = File("build/tmp-save2-${System.nanoTime()}")
        try {
            val mgr = SaveManager(FileSaveStorage(dir))
            val state = createNewGame(20240101)
            assertTrue(mgr.save(state, "3").ok)

            val slots = mgr.listSlots()
            assertEquals(listOf("1", "2", "3", "4", "5", "auto"), slots.map { it.slot })
            assertEquals(1, slots[2].day)
            assertTrue(slots[2].savedAt != null)
            assertTrue(slots[0].savedAt == null)
            assertTrue(mgr.load("1").ok.not())
        } finally {
            dir.deleteRecursively()
        }
    }
}
