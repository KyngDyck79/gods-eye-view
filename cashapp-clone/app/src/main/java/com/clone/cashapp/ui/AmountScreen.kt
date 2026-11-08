package com.clone.cashapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import com.clone.cashapp.data.Db
import com.clone.cashapp.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun AmountScreen(nav: NavController, mode: String) {
    val ctx = LocalContext.current
    val dao = remember { Db.get(ctx).dao() }
    val me by dao.me().collectAsStateWithLifecycle(initialValue = null)
    var input by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    var done by remember { mutableStateOf<Pair<String, String>?>(null) }

    done?.let { (t, d) -> SuccessView(t, d) { nav.popBackStack() }; return }
    val isAdd = mode == Routes.ADD

    Column(Modifier.fillMaxSize().background(CashBlack).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        TopBar(if (isAdd) "Add Cash" else "Cash Out", { nav.popBackStack() })
        Spacer(Modifier.height(20.dp))
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            FitText(
                if (input.isEmpty()) "$0" else "$$input",
                color = if (input.isEmpty()) TextSecondary else TextPrimary, maxSize = 56.sp,
            )
        }
        val cents = input.toCents()
        val limit = if (isAdd) Long.MAX_VALUE else (me?.balanceCents ?: 0L)
        if (cents > limit) Text("Insufficient funds", color = NegativeRed, fontSize = 14.sp)
        if (!isAdd) Text("Available: ${(me?.balanceCents ?: 0L).asMoney()}", color = TextSecondary, fontSize = 14.sp)
        Spacer(Modifier.weight(1f))
        Keypad(input) { input = it }
        Spacer(Modifier.height(16.dp))
        val amt = if (cents > 0) cents.asMoney() else ""
        val myId = me?.id
        GreenButton(if (isAdd) "Add $amt" else "Cash Out $amt", myId != null && cents in 1..limit) {
            if (myId != null) scope.launch {
                if (isAdd) dao.addCash(myId, cents) else dao.cashOut(myId, cents)
                done = (if (isAdd) "Added" else "Cashed out") to cents.asMoney()
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}
