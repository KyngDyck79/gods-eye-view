package com.clone.cashapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.clone.cashapp.ui.theme.*

@Composable
fun CardScreen(nav: NavController) {
    var virtual by rememberSaveable { mutableStateOf(false) }
    var locked by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(CashBlack).padding(20.dp)) {
        Spacer(Modifier.height(40.dp))
        Text("Stackz Card", color = TextPrimary, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(28.dp))
        Box(
            Modifier.fillMaxWidth().height(210.dp).clip(RoundedCornerShape(20.dp))
                .alpha(if (locked) 0.45f else 1f)
                .background(Brush.linearGradient(listOf(CashGreen, Color(0xFF66CB89)))),
            contentAlignment = Alignment.BottomStart,
        ) {
            Column(Modifier.padding(24.dp)) {
                Text("$", color = CashBlack, fontSize = 34.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(10.dp))
                if (virtual) {
                    // Demo-only placeholder number; not a real PAN.
                    Text("0000 0000 0000 4242", color = CashBlack, fontSize = 18.sp, fontFamily = FontFamily.Monospace)
                    Text("EXP 12/29   CVV •••", color = CashBlack, fontSize = 13.sp)
                    Spacer(Modifier.height(6.dp))
                }
                Text(if (locked) "STACKZ CARD · LOCKED" else "STACKZ CARD", color = CashBlack, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        Spacer(Modifier.height(28.dp))
        ToggleRow("Virtual card", "Show card details for online purchases", virtual) { virtual = it }
        Spacer(Modifier.height(16.dp))
        ToggleRow("Lock card", "Temporarily block all card payments", locked) { locked = it }
    }
}

@Composable
private fun ToggleRow(title: String, subtitle: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, color = TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.Medium)
            Text(subtitle, color = TextSecondary, fontSize = 13.sp)
        }
        Switch(
            checked = checked, onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = CashBlack, checkedTrackColor = CashGreen,
                uncheckedThumbColor = TextSecondary, uncheckedTrackColor = CardGray,
            ),
        )
    }
}
