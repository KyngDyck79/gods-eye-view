package com.clone.cashapp.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [Profile::class, Txn::class], version = 1, exportSchema = false)
abstract class Db : RoomDatabase() {
    abstract fun dao(): CashDao
    companion object {
        @Volatile private var inst: Db? = null
        fun get(ctx: Context): Db = inst ?: synchronized(this) {
            inst ?: Room.databaseBuilder(ctx.applicationContext, Db::class.java, "cashapp.db")
                .build().also { inst = it }
        }
    }
}
