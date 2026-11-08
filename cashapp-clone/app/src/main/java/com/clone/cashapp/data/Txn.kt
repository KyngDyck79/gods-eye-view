package com.clone.cashapp.data

import androidx.room.Entity
import androidx.room.PrimaryKey

enum class TxnType { SEND, RECEIVE, ADD, CASHOUT }

@Entity(tableName = "txns")
data class Txn(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val fromId: Long,
    val toId: Long,
    val amountCents: Long,
    val note: String,
    val type: TxnType,
    val timestamp: Long = System.currentTimeMillis(),
)
