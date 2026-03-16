package com.example.flutter_gps_tracker

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val BATTERY_CHANNEL = "com.example.flutter_gps_tracker/battery"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, BATTERY_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "requestBatteryExemption" -> {
                        val success = requestBatteryOptimizationExemption()
                        result.success(success)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                "gps_tracking_channel",
                "GPS Tracking",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Muestra el estado del rastreo GPS activo."
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun requestBatteryOptimizationExemption(): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
                val packageName = applicationContext.packageName
                
                // Verificar si ya está en whitelist
                if (powerManager.isIgnoringBatteryOptimizations(packageName)) {
                    android.util.Log.d("BatteryExemption", "Ya está en whitelist")
                    return true
                }
                
                // Solicitar exención (requiere permiso REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = android.net.Uri.parse("package:$packageName")
                }
                
                if (intent.resolveActivity(packageManager) != null) {
                    startActivity(intent)
                    android.util.Log.d("BatteryExemption", "Solicitud enviada")
                    true
                } else {
                    android.util.Log.d("BatteryExemption", "No hay activity para resolver la solicitud")
                    false
                }
            } else {
                true // Android < 6.0, no hay optimización de batería
            }
        } catch (e: Exception) {
            android.util.Log.e("BatteryExemption", "Error: ${e.message}")
            false
        }
    }
}
