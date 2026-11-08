package com.clone.cashapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Home
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.navArgument
import com.clone.cashapp.ui.theme.*

object Routes {
    const val ONBOARDING = "onboarding"
    const val HOME = "home"
    const val CARD = "card"
    const val QR = "qr"
    const val ADD = "add"
    const val OUT = "out"
    const val SEND = "send/{id}"
    const val REQUEST = "request/{id}"
    fun send(id: Long) = "send/$id"
    fun request(id: Long) = "request/$id"
}

private data class Tab(val route: String, val label: String, val icon: ImageVector)
private val tabs = listOf(
    Tab(Routes.HOME, "Money", Icons.Filled.Home),
    Tab(Routes.CARD, "Card", Icons.Filled.CreditCard),
)

@Composable
fun AppNav(nav: NavHostController, start: String) {
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    Scaffold(
        containerColor = CashBlack,
        bottomBar = {
            if (tabs.any { it.route == route }) {
                NavigationBar(containerColor = SurfaceDark) {
                    tabs.forEach { t ->
                        NavigationBarItem(
                            selected = route == t.route,
                            onClick = {
                                nav.navigate(t.route) {
                                    popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(t.icon, t.label) },
                            label = { Text(t.label) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = CashBlack, indicatorColor = CashGreen,
                                selectedTextColor = TextPrimary,
                                unselectedIconColor = TextSecondary, unselectedTextColor = TextSecondary,
                            ),
                        )
                    }
                }
            }
        },
    ) { inner ->
        NavHost(nav, startDestination = start, modifier = Modifier.background(CashBlack).padding(inner)) {
            composable(Routes.ONBOARDING) { Onboarding(nav) }
            composable(Routes.HOME) { Home(nav) }
            composable(Routes.CARD) { CardScreen(nav) }
            composable(Routes.QR) { QrScreen(nav) }
            composable(Routes.ADD) { AmountScreen(nav, Routes.ADD) }
            composable(Routes.OUT) { AmountScreen(nav, Routes.OUT) }
            composable(Routes.SEND, listOf(navArgument("id") { type = NavType.LongType })) {
                SendScreen(nav, it.arguments?.getLong("id") ?: 0L)
            }
            composable(Routes.REQUEST, listOf(navArgument("id") { type = NavType.LongType })) {
                RequestScreen(nav, it.arguments?.getLong("id") ?: 0L)
            }
        }
    }
}
