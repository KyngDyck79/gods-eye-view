package com.clone.cashapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
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
fun SendScreen(nav: NavController, toId: Long) {
    val ctx = LocalContext.current
    val dao = remember { Db.get(ctx).dao() }
    val me by dao.me().collectAsStateWithLifecycle(initialValue = null)
    val others by dao.others().collectAsStateWithLifecycle(initialValue = emptyList())
    val to = others.find { it.id == toId }
    var input by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    var done by remember { mutableStateOf<Pair<String, String>?>(null) }

    done?.let { (t, d) -> SuccessView(t, d) { nav.popBackStack() }; return }

    Column(Modifier.fillMaxSize().background(CashBlack).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        TopBar("Send to ${to?.name ?: ""}", { nav.popBackStack() })
        Text(
            "Request", color = CashGreen, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.align(Alignment.End).clickable {
                nav.navigate(Routes.request(toId)) { popUpTo(Routes.HOME) }
            }.padding(8.dp),
        )
        Spacer(Modifier.height(12.dp))
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            FitText(
                if (input.isEmpty()) "$0" else "$$input",
                color = if (input.isEmpty()) TextSecondary else TextPrimary, maxSize = 56.sp,
            )
        }
        val cents = input.toCents()
        val limit = me?.balanceCents ?: 0L
        if (cents > limit) Text("Insufficient funds", color = NegativeRed, fontSize = 14.sp)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = note, onValueChange = { note = it }, placeholder = { Text("For...") }, singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = CashGreen, unfocusedBorderColor = CardGray,
                focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.weight(1f))
        Keypad(input) { input = it }
        Spacer(Modifier.height(16.dp))
        val myId = me?.id
        GreenButton("Send ${if (cents > 0) cents.asMoney() else ""}", myId != null && to != null && cents in 1..limit) {
            if (myId != null) scope.launch { dao.send(myId, toId, cents, note.trim()); done = "Sent" to "${cents.asMoney()} to ${to?.name ?: ""}" }
        }
        Spacer(Modifier.height(24.dp))
    }
}
