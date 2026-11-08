package com.clone.cashapp.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.clone.cashapp.ui.theme.*

/** One-line text that shrinks from [maxSize] until it fits the available width. */
@Composable
fun FitText(
    text: String,
    color: Color,
    maxSize: TextUnit,
    modifier: Modifier = Modifier,
    minSize: TextUnit = 20.sp,
    weight: FontWeight = FontWeight.Bold,
) {
    BoxWithConstraints(modifier) {
        val measurer = rememberTextMeasurer()
        val density = LocalDensity.current
        val maxPx = with(density) { maxWidth.roundToPx() }
        val size = remember(text, maxPx) {
            var s = maxSize.value
            while (s > minSize.value &&
                measurer.measure(text, TextStyle(fontSize = s.sp, fontWeight = weight)).size.width > maxPx
            ) s -= 1f
            s.sp
        }
        Text(text, color = color, fontSize = size, fontWeight = weight, maxLines = 1, softWrap = false)
    }
}

/** Full-screen confirmation shown after a payment goes through. */
@Composable
fun SuccessView(title: String, detail: String, onDone: () -> Unit) {
    val haptic = LocalHapticFeedback.current
    val pop = remember { Animatable(0.4f) }
    LaunchedEffect(Unit) {
        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow))
    }
    Column(
        Modifier.fillMaxSize().background(CashBlack).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))
        Box(
            Modifier.size(96.dp).scale(pop.value).clip(CircleShape).background(CashGreen),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Filled.Check, null, tint = CashBlack, modifier = Modifier.size(56.dp)) }
        Spacer(Modifier.height(28.dp))
        Text(title, color = TextPrimary, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(10.dp))
        Text(detail, color = TextSecondary, fontSize = 16.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.weight(1f))
        GreenButton("Done", true, onDone)
        Spacer(Modifier.height(16.dp))
    }
}
