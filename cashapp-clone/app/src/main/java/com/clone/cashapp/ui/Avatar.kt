package com.clone.cashapp.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import com.clone.cashapp.R

/** Default name and avatar for the account owner. */
const val OWNER_NAME = "Digital Media Genius"

@Composable
fun OwnerAvatar(size: Dp, modifier: Modifier = Modifier) {
    Image(
        painterResource(R.drawable.avatar_hacker), "Profile picture",
        contentScale = ContentScale.Crop,
        modifier = modifier.size(size).clip(CircleShape),
    )
}
