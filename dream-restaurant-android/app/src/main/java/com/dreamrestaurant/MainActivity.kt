package com.dreamrestaurant

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.remember
import com.dreamrestaurant.ui.GameRunner
import com.dreamrestaurant.ui.GameScreen
import com.dreamrestaurant.ui.audio.GameAudio

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContent {
            MaterialTheme {
                Surface(color = Color(0xFF0e1426)) {
                    val runner = remember { GameRunner() }
                    GameScreen(runner)
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        GameAudio.setActive(true)
    }

    override fun onPause() {
        GameAudio.setActive(false)
        super.onPause()
    }

    override fun onDestroy() {
        GameAudio.stop()
        super.onDestroy()
    }
}
