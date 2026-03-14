package com.example.flutter_gps_tracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * BootReceiver — FIX C4
 *
 * Escucha el broadcast BOOT_COMPLETED del sistema para reiniciar el servicio
 * de tracking automáticamente después de que el dispositivo se reinicia.
 *
 * Sin este receiver, si el teléfono se reinicia el tracking permanece
 * silenciosamente inactivo hasta que el usuario abre la app manualmente.
 *
 * Flujo:
 *   1. Sistema emite BOOT_COMPLETED después del boot.
 *   2. Android lanza este receiver.
 *   3. Lanzamos MainActivity en background (necesario para que Flutter
 *      inicialice los plugins antes de arrancar el BackgroundService).
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != "android.intent.action.QUICKBOOT_POWERON"
        ) return

        Log.i("BootReceiver", "BOOT_COMPLETED recibido — iniciando GPS Tracking service")

        try {
            // Lanzar la app en background para que Flutter inicialice sus plugins
            // y flutter_background_service pueda arrancar.
            // FLAG_ACTIVITY_NEW_TASK: requerido para iniciar actividades fuera de un contexto de actividad.
            val launchIntent = Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra("from_boot", true)
            }
            context.startActivity(launchIntent)
        } catch (e: Exception) {
            Log.e("BootReceiver", "Error al iniciar actividad tras boot: ${e.message}")
        }
    }
}
