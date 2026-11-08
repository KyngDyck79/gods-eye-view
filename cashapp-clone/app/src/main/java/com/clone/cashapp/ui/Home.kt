package com.clone.cashapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCode
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import com.clone.cashapp.data.Db
import com.clone.cashapp.data.Profile
import com.clone.cashapp.data.Txn
import com.clone.cashapp.data.TxnType
import com.clone.cashapp.ui.theme.*

@Composable
fun Home(nav: NavController) {
    val ctx = LocalContext.current
    val dao = remember { Db.get(ctx).dao() }
    val me by dao.me().collectAsStateWithLifecycle(initialValue = null)
    val feed by dao.feed().collectAsStateWithLifecycle(initialValue = emptyList())
    val others by dao.others().collectAsStateWithLifecycle(initialValue = emptyList())
    val byId = remember(others) { others.associateBy { it.id } }

    Column(Modifier.fillMaxSize().background(CashBlack).padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(48.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            OwnerAvatar(40.dp)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(me?.name ?: "", color = TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Text("$" + (me?.cashtag ?: ""), color = TextSecondary, fontSize = 13.sp)
            }
            Spacer(Modifier.weight(1f))
            Icon(
                Icons.Filled.QrCode, "My QR code", tint = TextPrimary,
                modifier = Modifier.size(26.dp).clickable { nav.navigate(Routes.QR) },
            )
        }
        Spacer(Modifier.height(24.dp))
        Text(
            (me?.balanceCents ?: 0L).asMoney(),
            color = TextPrimary, fontSize = 56.sp, fontWeight = FontWeight.Bold, letterSpacing = (-1).sp,
        )
        Spacer(Modifier.height(28.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Pill("Add Cash") { nav.navigate(Routes.ADD) }
            Pill("Cash Out") { nav.navigate(Routes.OUT) }
        }
        Spacer(Modifier.height(32.dp))
        Text("Send to", color = TextSecondary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            others.take(5).forEach { p ->
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.clickable { nav.navigate(Routes.send(p.id)) },
                ) {
                    Box(Modifier.size(56.dp).clip(CircleShape).background(CardGray), contentAlignment = Alignment.Center) {
                        Text(p.name.take(1), color = TextPrimary, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(p.name.split(" ").first(), color = TextSecondary, fontSize = 12.sp)
                }
            }
        }
        Spacer(Modifier.height(32.dp))
        Text("Activity", color = TextSecondary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        if (feed.isEmpty()) {
            Text("No activity yet", color = TextSecondary, fontSize = 14.sp, modifier = Modifier.padding(vertical = 12.dp))
        }
        LazyColumn(Modifier.weight(1f)) {
            items(feed, key = { it.id }) { txn -> TxnRow(txn, me?.id ?: 0L, byId) }
        }
    }
}

@Composable
private fun Pill(label: String, onClick: () -> Unit) {
    Box(
        Modifier.clip(RoundedCornerShape(50)).background(CashGreen).clickable { onClick() }
            .padding(horizontal = 22.dp, vertical = 12.dp),
    ) { Text(label, color = CashBlack, fontWeight = FontWeight.SemiBold, fontSize = 15.sp) }
}

@Composable
private fun TxnRow(txn: Txn, meId: Long, people: Map<Long, Profile>) {
    val out = (txn.type == TxnType.SEND && txn.fromId == meId) || txn.type == TxnType.CASHOUT
    val counterparty = people[if (txn.fromId == meId) txn.toId else txn.fromId]?.name
    val title = when (txn.type) {
        TxnType.SEND, TxnType.RECEIVE -> counterparty ?: if (out) "Sent" else "Received"
        TxnType.ADD -> "Added cash"
        TxnType.CASHOUT -> "Cashed out"
    }
    val subtitle = if (txn.type == TxnType.SEND || txn.type == TxnType.RECEIVE) txn.note else ""
    Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(42.dp).clip(CircleShape).background(CardGray), contentAlignment = Alignment.Center) {
            Text(if (out) "↑" else "↓", color = TextPrimary)
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = TextPrimary, fontSize = 15.sp)
            if (subtitle.isNotBlank()) Text(subtitle, color = TextSecondary, fontSize = 13.sp)
        }
        Text(
            (if (out) "-" else "+") + txn.amountCents.asMoney(),
            color = if (out) TextPrimary else CashGreen, fontWeight = FontWeight.Medium,
        )
    }
}
