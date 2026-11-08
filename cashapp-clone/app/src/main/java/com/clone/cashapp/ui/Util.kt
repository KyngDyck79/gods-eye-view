package com.clone.cashapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clone.cashapp.ui.theme.CardGray
import com.clone.cashapp.ui.theme.CashBlack
import com.clone.cashapp.ui.theme.CashGreen
import com.clone.cashapp.ui.theme.TextPrimary
import com.clone.cashapp.ui.theme.TextSecondary
import java.text.NumberFormat
import java.util.Locale

private val money = NumberFormat.getCurrencyInstance(Locale.US)
fun Long.asMoney(): String = money.format(this / 100.0)

/** Parses keypad input ("12.5") to cents without floating-point rounding errors. */
fun String.toCents(): Long = toBigDecimalOrNull()?.movePointRight(2)?.toLong() ?: 0L

val pad = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫")

fun applyKey(input: String, k: String): String = when (k) {
    "⌫" -> input.dropLast(1)
    "." -> if (!input.contains(".")) input + "." else input
    else -> when {
        input.contains(".") && input.substringAfter(".").length >= 2 -> input // max 2 decimals
        input.count { it.isDigit() } < 7 -> input + k
        else -> input
    }
}

@Composable
fun GreenButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().height(54.dp)
            .clip(RoundedCornerShape(50))
            .background(if (enabled) CashGreen else CardGray)
            .clickable(enabled = enabled) { onClick() },
        contentAlignment = Alignment.Center,
    ) { Text(label, color = if (enabled) CashBlack else TextSecondary, fontWeight = FontWeight.SemiBold, fontSize = 17.sp) }
}

@Composable
fun Keypad(input: String, onChange: (String) -> Unit) {
    for (row in pad.chunked(3)) {
        Row(Modifier.fillMaxWidth()) {
            row.forEach { k ->
                Box(
                    Modifier.weight(1f).height(64.dp).clickable { onChange(applyKey(input, k)) },
                    contentAlignment = Alignment.Center,
                ) { Text(k, color = TextPrimary, fontSize = 26.sp) }
            }
        }
    }
}

@Composable
fun TopBar(title: String, onBack: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("‹", color = TextPrimary, fontSize = 30.sp, modifier = Modifier.clickable { onBack() }.padding(horizontal = 8.dp))
        Text(title, color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
    }
}
