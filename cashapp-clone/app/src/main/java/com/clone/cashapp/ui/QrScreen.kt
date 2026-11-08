package com.clone.cashapp.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import com.clone.cashapp.data.Db
import com.clone.cashapp.ui.theme.*
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private suspend fun makeQr(text: String): Bitmap = withContext(Dispatchers.Default) {
    val size = 600
    val bits = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size)
    val pixels = IntArray(size * size) { i ->
        if (bits[i % size, i / size]) android.graphics.Color.BLACK else android.graphics.Color.WHITE
    }
    Bitmap.createBitmap(pixels, size, size, Bitmap.Config.RGB_565)
}

@Composable
fun QrScreen(nav: NavController) {
    val ctx = LocalContext.current
    val dao = remember { Db.get(ctx).dao() }
    val me by dao.me().collectAsStateWithLifecycle(initialValue = null)
    var bmp by remember { mutableStateOf<Bitmap?>(null) }

    LaunchedEffect(me?.cashtag) {
        me?.cashtag?.let { bmp = makeQr("https://cash.app/\$$it") }
    }

    Column(Modifier.fillMaxSize().background(CashBlack).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        TopBar("My QR Code", { nav.popBackStack() })
        Spacer(Modifier.weight(1f))
        bmp?.let {
            Image(
                it.asImageBitmap(), "QR code for my cashtag",
                modifier = Modifier.size(260.dp).clip(RoundedCornerShape(16.dp)),
            )
        }
        Spacer(Modifier.height(24.dp))
        Text("$" + (me?.cashtag ?: ""), color = TextPrimary, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Text(me?.name ?: "", color = TextSecondary, fontSize = 15.sp)
        Spacer(Modifier.weight(1f))
    }
}
