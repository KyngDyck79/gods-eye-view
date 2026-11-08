package com.clone.cashapp.data

import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/** Starting data for a new account: the balance and a send-out history. */
object Seed {
    const val START_BALANCE_CENTS = 271_282_509L // $2,712,825.09

    val contacts = listOf(
        Profile(name = "Jordan Blake", cashtag = "jblake", balanceCents = 4_200),
        Profile(name = "Maya Torres", cashtag = "mayat", balanceCents = 13_300),
        Profile(name = "Sam Rivera", cashtag = "samr", balanceCents = 900),
    )

    private val notes = listOf("Rent", "Dinner", "Car note", "Gift", "Groceries", "Concert tickets", "Shopping", "Bills")

    /**
     * Alternating $500 / $5,000 sends, every ~9 days from Feb 2, 2026 up to today.
     * These are display history only; they don't change the starting balance.
     */
    fun history(meId: Long, recipientIds: List<Long>, today: LocalDate = LocalDate.now()): List<Txn> {
        val zone = ZoneId.systemDefault()
        val out = mutableListOf<Txn>()
        var day = LocalDate.of(2026, 2, 2)
        var i = 0
        while (!day.isAfter(today) && recipientIds.isNotEmpty()) {
            val time = LocalTime.of(9 + (i * 5) % 11, (i * 17) % 60)
            out += Txn(
                fromId = meId,
                toId = recipientIds[i % recipientIds.size],
                amountCents = if (i % 2 == 0) 50_000L else 500_000L,
                note = notes[i % notes.size],
                type = TxnType.SEND,
                timestamp = day.atTime(time).atZone(zone).toInstant().toEpochMilli(),
            )
            day = day.plusDays(8L + i % 3)
            i++
        }
        return out
    }
}
