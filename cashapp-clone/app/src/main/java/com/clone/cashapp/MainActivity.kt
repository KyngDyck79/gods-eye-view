package com.clone.cashapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.navigation.compose.rememberNavController
import com.clone.cashapp.data.Db
import com.clone.cashapp.ui.AppNav
import com.clone.cashapp.ui.Routes
import com.clone.cashapp.ui.theme.CashAppTheme
import com.clone.cashapp.ui.theme.CashBlack

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dao = Db.get(this).dao()
        setContent {
            CashAppTheme {
                // Decide the start screen once: onboarding until a profile exists.
                var start by remember { mutableStateOf<String?>(null) }
                LaunchedEffect(Unit) { start = if (dao.count() > 0) Routes.HOME else Routes.ONBOARDING }
                val s = start
                if (s == null) Box(Modifier.fillMaxSize().background(CashBlack))
                else AppNav(rememberNavController(), s)
            }
        }
    }
}
