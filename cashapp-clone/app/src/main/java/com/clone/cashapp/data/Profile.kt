package com.clone.cashapp.data

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "profiles")
data class Profile(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val cashtag: String,
    val balanceCents: Long,
    val isCurrentUser: Boolean = false,
)
