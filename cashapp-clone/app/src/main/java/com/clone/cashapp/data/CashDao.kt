package com.clone.cashapp.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
interface CashDao {
    @Query("SELECT * FROM profiles WHERE isCurrentUser = 1 LIMIT 1")
    fun me(): Flow<Profile?>

    @Query("SELECT * FROM profiles WHERE isCurrentUser = 0")
    fun others(): Flow<List<Profile>>

    @Query("SELECT * FROM profiles WHERE cashtag LIKE '%' || :q || '%' AND isCurrentUser = 0")
    fun search(q: String): Flow<List<Profile>>

    @Query("SELECT * FROM txns ORDER BY timestamp DESC")
    fun feed(): Flow<List<Txn>>

    @Query("SELECT * FROM profiles WHERE id = :id")
    suspend fun byId(id: Long): Profile?

    @Query("UPDATE profiles SET balanceCents = balanceCents - :amt WHERE id = :id")
    suspend fun debit(id: Long, amt: Long)

    @Query("UPDATE profiles SET balanceCents = balanceCents + :amt WHERE id = :id")
    suspend fun credit(id: Long, amt: Long)

    @Insert suspend fun insertTxn(t: Txn)
    @Insert suspend fun insertProfile(p: Profile): Long

    @Query("UPDATE profiles SET name = :name, cashtag = :tag WHERE id = :id")
    suspend fun updateMe(id: Long, name: String, tag: String)

    @Query("SELECT COUNT(*) FROM profiles") suspend fun count(): Int

    @Transaction
    suspend fun send(from: Long, to: Long, amt: Long, note: String) {
        debit(from, amt); credit(to, amt)
        insertTxn(Txn(fromId = from, toId = to, amountCents = amt, note = note, type = TxnType.SEND))
    }

    @Transaction
    suspend fun request(from: Long, to: Long, amt: Long, note: String) {
        credit(from, amt); debit(to, amt)
        insertTxn(Txn(fromId = to, toId = from, amountCents = amt, note = note, type = TxnType.RECEIVE))
    }

    @Transaction
    suspend fun addCash(id: Long, amt: Long) {
        credit(id, amt)
        insertTxn(Txn(fromId = id, toId = id, amountCents = amt, note = "Added cash", type = TxnType.ADD))
    }

    @Transaction
    suspend fun cashOut(id: Long, amt: Long) {
        debit(id, amt)
        insertTxn(Txn(fromId = id, toId = id, amountCents = amt, note = "Cashed out", type = TxnType.CASHOUT))
    }
}
