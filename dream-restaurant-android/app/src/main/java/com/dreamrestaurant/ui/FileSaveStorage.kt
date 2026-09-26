package com.dreamrestaurant.ui

import com.dreamrestaurant.core.SaveStorage
import java.io.File

/**
 * 以「一個檔案 = 一個存檔 key」實作的本地儲存，
 * 檔名會把 key 裡的特殊字元換掉（存檔 key 形如 `dreamrestaurant.save.1`）。
 */
class FileSaveStorage(private val dir: File) : SaveStorage {

    init {
        try {
            dir.mkdirs()
        } catch (_: Throwable) {
        }
    }

    private val safe = Regex("[^A-Za-z0-9._-]")

    private fun fileFor(key: String): File = File(dir, key.replace(safe, "_"))

    override fun read(key: String): String? = try {
        val f = fileFor(key)
        if (f.exists()) f.readText() else null
    } catch (_: Throwable) {
        null
    }

    override fun write(key: String, value: String) {
        fileFor(key).writeText(value)
    }

    override fun remove(key: String) {
        try {
            fileFor(key).delete()
        } catch (_: Throwable) {
        }
    }

    override fun allKeys(): List<String> = try {
        dir.list()?.toList() ?: emptyList()
    } catch (_: Throwable) {
        emptyList()
    }
}
