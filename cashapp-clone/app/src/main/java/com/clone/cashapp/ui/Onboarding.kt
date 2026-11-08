package com.clone.cashapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.clone.cashapp.data.Db
import com.clone.cashapp.data.Profile
import com.clone.cashapp.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun Onboarding(nav: NavController) {
    val ctx = LocalContext.current
    val dao = remember { Db.get(ctx).dao() }
    var step by remember { mutableStateOf(0) }
    var name by remember { mutableStateOf(OWNER_NAME) }
    var tag by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxSize().background(CashBlack).padding(24.dp)) {
        Spacer(Modifier.height(80.dp))
        when (step) {
            0 -> {
                OwnerAvatar(88.dp)
                Spacer(Modifier.height(24.dp))
                Text("Welcome to Cash App", color = TextPrimary, fontSize = 30.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(40.dp))
                OutlinedTextField(
                    value = name, onValueChange = { name = it },
                    label = { Text("Your name") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = CashGreen, unfocusedBorderColor = CardGray,
                        focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
                        focusedLabelColor = CashGreen, unfocusedLabelColor = TextSecondary,
                    ),
                )
                Spacer(Modifier.weight(1f))
                GreenButton("Continue", name.isNotBlank()) { step = 1 }
            }
            1 -> {
                Text("Choose your \$cashtag", color = TextPrimary, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(40.dp))
                OutlinedTextField(
                    value = tag, onValueChange = { tag = it.lowercase().filter { c -> c.isLetterOrDigit() } },
                    prefix = { Text("$", color = TextSecondary) }, singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = CashGreen, unfocusedBorderColor = CardGray,
                        focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
                    ),
                )
                Spacer(Modifier.weight(1f))
                GreenButton("Finish", tag.isNotBlank()) {
                    scope.launch {
                        dao.insertProfile(Profile(name = name.trim(), cashtag = tag, balanceCents = 0, isCurrentUser = true))
                        dao.insertProfile(Profile(name = "Jordan Blake", cashtag = "jblake", balanceCents = 4200))
                        dao.insertProfile(Profile(name = "Maya Torres", cashtag = "mayat", balanceCents = 13300))
                        dao.insertProfile(Profile(name = "Sam Rivera", cashtag = "samr", balanceCents = 900))
                        nav.navigate(Routes.HOME) { popUpTo(Routes.ONBOARDING) { inclusive = true } }
                    }
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}
