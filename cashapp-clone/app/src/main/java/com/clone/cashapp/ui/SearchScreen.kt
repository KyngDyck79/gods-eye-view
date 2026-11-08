package com.clone.cashapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
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
import com.clone.cashapp.ui.theme.*
import kotlinx.coroutines.launch

/** Find a contact by name or $tag, or add a new one on the spot. */
@Composable
fun SearchScreen(nav: NavController) {
    val ctx = LocalContext.current
    val dao = remember { Db.get(ctx).dao() }
    var q by remember { mutableStateOf("") }
    val query = q.trim().removePrefix("$")
    val results by remember(query) { dao.search(query) }.collectAsStateWithLifecycle(initialValue = emptyList())
    val scope = rememberCoroutineScope()
    val exact = results.any { it.name.equals(query, true) || it.cashtag.equals(query, true) }

    Column(Modifier.fillMaxSize().background(CashBlack).padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(40.dp))
        Text("Search", color = TextPrimary, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = q, onValueChange = { q = it }, singleLine = true,
            placeholder = { Text("Name or \$tag") },
            leadingIcon = { Icon(Icons.Filled.Search, null, tint = TextSecondary) },
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = CashGreen, unfocusedBorderColor = CardGray,
                focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        LazyColumn(Modifier.weight(1f)) {
            if (query.isNotEmpty() && !exact) {
                item {
                    Row(
                        Modifier.fillMaxWidth().clickable {
                            scope.launch {
                                val tag = query.lowercase().filter { it.isLetterOrDigit() }.ifEmpty { "friend" }
                                val name = if (q.trim().startsWith("$")) tag else query
                                val id = dao.insertProfile(Profile(name = name, cashtag = tag, balanceCents = 0))
                                q = ""
                                nav.navigate(Routes.send(id))
                            }
                        }.padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(44.dp).clip(CircleShape).background(CashGreen), contentAlignment = Alignment.Center) {
                            Text("+", color = CashBlack, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.width(14.dp))
                        Column {
                            Text("Add \"$query\"", color = TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                            Text("New recipient", color = TextSecondary, fontSize = 13.sp)
                        }
                    }
                }
            }
            items(results, key = { it.id }) { p ->
                Row(
                    Modifier.fillMaxWidth().clickable { nav.navigate(Routes.send(p.id)) }.padding(vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(44.dp).clip(CircleShape).background(CardGray), contentAlignment = Alignment.Center) {
                        Text(p.name.take(1).uppercase(), color = TextPrimary, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.width(14.dp))
                    Column {
                        Text(p.name, color = TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                        Text("$" + p.cashtag, color = TextSecondary, fontSize = 13.sp)
                    }
                }
            }
        }
    }
}
